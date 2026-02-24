import type { Context } from '@netlify/functions'
import type { AtpSessionData } from '@atproto/api'
import { IdResolver } from '@atproto/identity'
import {
    createHash,
    createPrivateKey,
    generateKeyPairSync,
    randomBytes,
    sign
} from 'node:crypto'

const OAUTH_INIT_COOKIE = 'drerings_oauth_init'
const AUTH_COOKIE = 'drerings_auth'
const OAUTH_INIT_TTL_SECONDS = 60 * 15
const AUTH_TTL_SECONDS = 60 * 60 * 24 * 14
const DEFAULT_SCOPE = 'atproto transition:generic'
const OAUTH_CALLBACK_PATH = '/login'

const idResolver = new IdResolver()

type DpopPublicJwk = {
    kty:'EC';
    crv:'P-256';
    x:string;
    y:string;
}

type DpopPrivateJwk = DpopPublicJwk & {
    d:string;
}

type OAuthInitCookie = {
    state:string;
    codeVerifier:string;
    dpopPublicJwk?:DpopPublicJwk;
    dpopPrivateJwk?:DpopPrivateJwk;
    authServerDpopNonce?:string|null;
    pdsOrigin:string;
    issuer:string;
    authorizationEndpoint:string;
    tokenEndpoint:string;
    parEndpoint:string;
    did:string;
    handle:string;
    redirectUri:string;
    clientId:string;
    scope:string;
    createdAt:number;
}

type Profile = {
    did:string;
    handle:string;
    avatar:string;
}

type AuthCookie = {
    service:string;
    session:AtpSessionData;
    profile:Profile|null;
    oauth:{
        accessToken:string;
        refreshToken:string|null;
        scope:string|null;
        expiresIn:number|null;
        dpopPublicJwk?:DpopPublicJwk;
        dpopPrivateJwk?:DpopPrivateJwk;
        pdsDpopNonce?:string|null;
        authServerDpopNonce?:string|null;
    };
    updatedAt:number;
}

type OAuthTokenResponse = {
    access_token:string;
    refresh_token?:string;
    scope?:string;
    expires_in?:number;
    sub?:string;
    token_type?:string;
}

type OAuthStartBody = {
    handle?:string;
    redirectTo?:string;
}

type OAuthFinishBody = {
    query?:string;
    redirectTo?:string;
}

type ProtectedResourceMetadata = {
    authorization_servers?:string[];
}

type AuthorizationServerMetadata = {
    issuer?:string;
    authorization_endpoint?:string;
    token_endpoint?:string;
    pushed_authorization_request_endpoint?:string;
}

export default async function handler (req:Request, _context:Context) {
    try {
        const subpath = getAuthSubpath(req)

        if (req.method === 'GET' && subpath === '/oauth/client-metadata') {
            return oauthClientMetadata(req)
        }

        if (req.method === 'POST' && subpath === '/oauth/start') {
            return oauthStart(req)
        }

        if (req.method === 'POST' && subpath === '/oauth/finish') {
            return oauthFinish(req)
        }

        if (req.method === 'GET' && subpath === '/status') {
            return authStatus(req)
        }

        if (req.method === 'GET' && subpath === '/session') {
            return authSession(req)
        }

        if (req.method === 'POST' && subpath === '/logout') {
            return authLogout(req)
        }

        if (subpath.startsWith('/xrpc/')) {
            return authXrpc(req, subpath)
        }

        return jsonResponse({ error: 'Not found' }, 404)
    } catch (err) {
        return jsonResponse({ error: getErrorMessage(err) }, 500)
    }
}

function getAuthSubpath (req:Request):string {
    const pathname = new URL(req.url).pathname
    const marker = '/auth'
    const index = pathname.lastIndexOf(marker)
    if (index === -1) return '/'
    const subpath = pathname.slice(index + marker.length)
    return subpath || '/'
}

function requestOrigin (req:Request):string {
    const proto = req.headers.get('x-forwarded-proto')
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (proto && host) {
        return `${proto}://${host}`
    }
    return new URL(req.url).origin
}

function normalizeRedirectUri (req:Request, input?:string):string {
    const base = requestOrigin(req)
    const url = new URL(input || OAUTH_CALLBACK_PATH, base)
    if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1'
    }
    return url.toString()
}

function normalizeHandle (input:string):string {
    const trimmed = input.trim().replace(/^@/, '')
    if (!trimmed.includes('.')) return `${trimmed}.bsky.social`
    return trimmed
}

function isLoopbackHost (hostname:string):boolean {
    return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function buildClientId ({
    redirectUri,
    scope
}:{
    redirectUri:string;
    scope:string;
}):string {
    const redirect = new URL(redirectUri)

    // Local development exception from atproto OAuth spec.
    if (isLoopbackHost(redirect.hostname)) {
        const localhostClientId = new URL('http://localhost')
        localhostClientId.searchParams.append('redirect_uri', redirectUri)
        localhostClientId.searchParams.set('scope', scope)
        return localhostClientId.toString()
    }

    const metadataOrigin = process.env.BSKY_OAUTH_CLIENT_ORIGIN || redirect.origin
    const clientIdUrl = new URL('/api/auth/oauth/client-metadata', metadataOrigin)
    clientIdUrl.searchParams.set('redirect_uri', redirectUri)
    clientIdUrl.searchParams.set('scope', scope)
    return clientIdUrl.toString()
}

function asDpopPublicJwk (value:unknown):DpopPublicJwk|null {
    const jwk = value as Record<string, unknown> | null
    if (
        !jwk ||
        jwk.kty !== 'EC' ||
        jwk.crv !== 'P-256' ||
        typeof jwk.x !== 'string' ||
        typeof jwk.y !== 'string'
    ) {
        return null
    }

    return {
        kty: 'EC',
        crv: 'P-256',
        x: jwk.x,
        y: jwk.y
    }
}

function asDpopPrivateJwk (value:unknown):DpopPrivateJwk|null {
    const jwk = value as Record<string, unknown> | null
    const publicJwk = asDpopPublicJwk(value)

    if (!publicJwk || !jwk || typeof jwk.d !== 'string') {
        return null
    }

    return {
        ...publicJwk,
        d: jwk.d
    }
}

function createDpopKeyPair (): { publicJwk:DpopPublicJwk; privateJwk:DpopPrivateJwk } {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256'
    })
    const publicJwk = asDpopPublicJwk(publicKey.export({ format: 'jwk' }))
    const privateJwk = asDpopPrivateJwk(privateKey.export({ format: 'jwk' }))

    if (!publicJwk || !privateJwk) {
        throw new Error('Failed to create DPoP key pair')
    }

    return { publicJwk, privateJwk }
}

function getOrCreateDpopKeyPair (
    initCookie:OAuthInitCookie
): { publicJwk:DpopPublicJwk; privateJwk:DpopPrivateJwk } {
    const publicJwk = asDpopPublicJwk(initCookie.dpopPublicJwk)
    const privateJwk = asDpopPrivateJwk(initCookie.dpopPrivateJwk)
    if (publicJwk && privateJwk) {
        return { publicJwk, privateJwk }
    }
    return createDpopKeyPair()
}

function dpopThumbprint (jwk:DpopPublicJwk):string {
    const canonical = JSON.stringify({
        crv: jwk.crv,
        kty: jwk.kty,
        x: jwk.x,
        y: jwk.y
    })
    return createHash('sha256').update(canonical).digest('base64url')
}

function dpopProof ({
    method,
    url,
    publicJwk,
    privateJwk,
    nonce,
    accessToken
}:{
    method:string;
    url:string;
    publicJwk:DpopPublicJwk;
    privateJwk:DpopPrivateJwk;
    nonce?:string;
    accessToken?:string;
}):string {
    const htu = new URL(url)
    htu.search = ''
    htu.hash = ''

    const header = {
        typ: 'dpop+jwt',
        alg: 'ES256',
        jwk: publicJwk
    }
    const payload:Record<string, string|number> = {
        jti: randomBytes(16).toString('base64url'),
        htm: method.toUpperCase(),
        htu: htu.toString(),
        iat: Math.floor(Date.now() / 1000)
    }

    if (nonce) {
        payload.nonce = nonce
    }

    if (accessToken) {
        payload.ath = createHash('sha256')
            .update(accessToken)
            .digest('base64url')
    }

    const encodedHeader = Buffer.from(JSON.stringify(header))
        .toString('base64url')
    const encodedPayload = Buffer.from(JSON.stringify(payload))
        .toString('base64url')
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const key = createPrivateKey({ key: privateJwk, format: 'jwk' })
    const signature = sign('sha256', Buffer.from(signingInput), {
        key,
        dsaEncoding: 'ieee-p1363'
    }).toString('base64url')

    return `${signingInput}.${signature}`
}

async function fetchWithDpop (
    url:string,
    init:{
        method:string;
        headers?:HeadersInit;
        body?:BodyInit;
        accessToken?:string;
        publicJwk:DpopPublicJwk;
        privateJwk:DpopPrivateJwk;
        nonce?:string|null;
    }
):Promise<{ res:Response; nonce:string|null }> {
    let nonce = init.nonce || null

    for (let i = 0; i < 3; i++) {
        const headers = new Headers(init.headers)
        headers.set('DPoP', dpopProof({
            method: init.method,
            url,
            publicJwk: init.publicJwk,
            privateJwk: init.privateJwk,
            nonce: nonce || undefined,
            accessToken: init.accessToken
        }))
        if (init.accessToken) {
            headers.set('authorization', `DPoP ${init.accessToken}`)
        }

        const res = await fetch(url, {
            method: init.method,
            headers,
            body: init.body
        })
        const nextNonce = res.headers.get('DPoP-Nonce')

        // Servers can challenge with a fresh nonce; retry once we have one.
        if (!res.ok && nextNonce) {
            nonce = nextNonce
            continue
        }

        return { res, nonce: nextNonce || nonce }
    }

    throw new Error('DPoP request failed after nonce retries')
}

async function readJsonResponse<T> (res:Response):Promise<T> {
    try {
        return await res.json() as T
    } catch {
        return {} as T
    }
}

function parseCookies (req:Request):Record<string, string> {
    const raw = req.headers.get('cookie')
    if (!raw) return {}

    const parsed:Record<string, string> = {}
    for (const pair of raw.split(';')) {
        const [name, ...rest] = pair.trim().split('=')
        if (!name) continue
        parsed[name] = decodeURIComponent(rest.join('='))
    }
    return parsed
}

function readCookieJson<T> (req:Request, name:string):T|null {
    const cookies = parseCookies(req)
    if (!cookies[name]) return null
    try {
        return JSON.parse(cookies[name]) as T
    } catch {
        return null
    }
}

function cookieString (
    req:Request,
    name:string,
    value:string,
    maxAge:number
):string {
    const secure = requestOrigin(req).startsWith('https://')
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`
    ]

    if (secure) {
        parts.push('Secure')
    }

    return parts.join('; ')
}

function clearCookie (req:Request, name:string):string {
    return cookieString(req, name, '', 0)
}

function jsonResponse (
    body:unknown,
    status = 200,
    headers?:Headers
):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: headers || {
            'content-type': 'application/json; charset=utf-8'
        }
    })
}

async function readJsonBody<T> (req:Request):Promise<T> {
    try {
        return (await req.json()) as T
    } catch {
        return {} as T
    }
}

function getErrorMessage (err:unknown):string {
    if (err instanceof Error) return err.message
    return 'Unexpected auth error'
}

async function discoverAuthorizationServer (pdsOrigin:string):Promise<{
    issuer:string;
    authorizationEndpoint:string;
    tokenEndpoint:string;
    parEndpoint:string;
}> {
    const protectedResourceUrl = new URL(
        '/.well-known/oauth-protected-resource',
        pdsOrigin
    )
    const protectedResourceRes = await fetch(protectedResourceUrl)
    if (!protectedResourceRes.ok) {
        throw new Error('Failed to fetch oauth-protected-resource metadata')
    }

    const protectedResource = await protectedResourceRes.json() as
    ProtectedResourceMetadata
    const issuer = protectedResource.authorization_servers?.[0] || pdsOrigin

    const authServerUrl = new URL('/.well-known/oauth-authorization-server', issuer)
    const authServerRes = await fetch(authServerUrl)
    if (!authServerRes.ok) {
        throw new Error('Failed to fetch oauth-authorization-server metadata')
    }

    const authServer = await authServerRes.json() as AuthorizationServerMetadata
    if (!authServer.authorization_endpoint) {
        throw new Error('Authorization server missing authorization_endpoint')
    }
    if (!authServer.token_endpoint) {
        throw new Error('Authorization server missing token_endpoint')
    }
    if (!authServer.pushed_authorization_request_endpoint) {
        throw new Error(
            'Authorization server missing pushed_authorization_request_endpoint'
        )
    }

    return {
        issuer: authServer.issuer || issuer,
        authorizationEndpoint: authServer.authorization_endpoint,
        tokenEndpoint: authServer.token_endpoint,
        parEndpoint: authServer.pushed_authorization_request_endpoint
    }
}

async function createParRequest ({
    endpoint,
    clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
    dpopJkt,
    handle,
    dpopPublicJwk,
    dpopPrivateJwk,
    authServerNonce
}:{
    endpoint:string;
    clientId:string;
    redirectUri:string;
    scope:string;
    state:string;
    codeChallenge:string;
    dpopJkt:string;
    handle:string;
    dpopPublicJwk:DpopPublicJwk;
    dpopPrivateJwk:DpopPrivateJwk;
    authServerNonce?:string|null;
}):Promise<{ requestUri:string; nonce:string|null }> {
    const body = new URLSearchParams()
    body.set('client_id', clientId)
    body.set('redirect_uri', redirectUri)
    body.set('response_type', 'code')
    body.set('scope', scope)
    body.set('state', state)
    body.set('code_challenge', codeChallenge)
    body.set('code_challenge_method', 'S256')
    body.set('dpop_jkt', dpopJkt)
    body.set('login_hint', handle)

    const { res, nonce } = await fetchWithDpop(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json'
        },
        body: body.toString(),
        publicJwk: dpopPublicJwk,
        privateJwk: dpopPrivateJwk,
        nonce: authServerNonce || null
    })

    const data = await readJsonResponse<{
        request_uri?:string;
        error?:string;
        error_description?:string;
    }>(res)

    if (!res.ok || !data.request_uri) {
        throw new Error(data.error_description || data.error || 'PAR request failed')
    }

    return { requestUri: data.request_uri, nonce }
}

function pkceCodeVerifier ():string {
    return randomBytes(32).toString('base64url')
}

function pkceCodeChallenge (codeVerifier:string):string {
    return createHash('sha256').update(codeVerifier).digest('base64url')
}

async function oauthStart (req:Request):Promise<Response> {
    const body = await readJsonBody<OAuthStartBody>(req)
    if (!body?.handle?.trim()) {
        return jsonResponse({ error: 'handle is required' }, 400)
    }

    const handle = normalizeHandle(body.handle)
    const redirectUri = normalizeRedirectUri(req, body.redirectTo)
    const scope = process.env.BSKY_OAUTH_SCOPE || DEFAULT_SCOPE

    const did = await idResolver.handle.resolve(handle)
    if (!did) {
        return jsonResponse({ error: 'Could not resolve handle' }, 400)
    }

    const atprotoData = await idResolver.did.resolveAtprotoData(did)
    const pdsOrigin = new URL(atprotoData.pds).origin
    const authServer = await discoverAuthorizationServer(pdsOrigin)
    const codeVerifier = pkceCodeVerifier()
    const state = randomBytes(16).toString('base64url')
    const codeChallenge = pkceCodeChallenge(codeVerifier)
    const clientId = buildClientId({ redirectUri, scope })
    const dpopKeyPair = createDpopKeyPair()
    const dpopJkt = dpopThumbprint(dpopKeyPair.publicJwk)

    const par = await createParRequest({
        endpoint: authServer.parEndpoint,
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        dpopJkt,
        handle,
        dpopPublicJwk: dpopKeyPair.publicJwk,
        dpopPrivateJwk: dpopKeyPair.privateJwk
    })

    const authorizeUrl = new URL(authServer.authorizationEndpoint)
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('request_uri', par.requestUri)

    const initPayload:OAuthInitCookie = {
        state,
        codeVerifier,
        dpopPublicJwk: dpopKeyPair.publicJwk,
        dpopPrivateJwk: dpopKeyPair.privateJwk,
        authServerDpopNonce: par.nonce,
        pdsOrigin,
        issuer: authServer.issuer,
        authorizationEndpoint: authServer.authorizationEndpoint,
        tokenEndpoint: authServer.tokenEndpoint,
        parEndpoint: authServer.parEndpoint,
        did,
        handle,
        redirectUri,
        clientId,
        scope,
        createdAt: Date.now()
    }

    const headers = new Headers({
        'content-type': 'application/json; charset=utf-8'
    })
    headers.append(
        'Set-Cookie',
        cookieString(
            req,
            OAUTH_INIT_COOKIE,
            JSON.stringify(initPayload),
            OAUTH_INIT_TTL_SECONDS
        )
    )

    return jsonResponse({
        authorizeUrl: authorizeUrl.toString(),
        redirectUri,
        clientId
    }, 200, headers)
}

async function oauthFinish (req:Request):Promise<Response> {
    const initCookie = readCookieJson<OAuthInitCookie>(req, OAUTH_INIT_COOKIE)
    if (!initCookie) {
        return jsonResponse({ error: 'Missing OAuth initialization cookie' }, 400)
    }

    const body = await readJsonBody<OAuthFinishBody>(req)
    const query = new URLSearchParams((body.query || '').replace(/^\?/, ''))
    const error = query.get('error')

    if (error) {
        return jsonResponse({
            error,
            error_description: query.get('error_description') || 'OAuth denied'
        }, 400)
    }

    const code = query.get('code')
    const state = query.get('state')
    const iss = query.get('iss')
    if (!code || !state) {
        return jsonResponse({ error: 'Missing OAuth code/state' }, 400)
    }

    if (state !== initCookie.state) {
        return jsonResponse({ error: 'Invalid OAuth state' }, 400)
    }

    if (iss && iss !== initCookie.issuer) {
        return jsonResponse({ error: 'OAuth issuer mismatch' }, 400)
    }

    const expectedRedirect = normalizeRedirectUri(req, body.redirectTo)
    if (expectedRedirect !== initCookie.redirectUri) {
        return jsonResponse({ error: 'Redirect URI mismatch' }, 400)
    }

    const tokenBody = new URLSearchParams()
    tokenBody.set('grant_type', 'authorization_code')
    tokenBody.set('code', code)
    tokenBody.set('client_id', initCookie.clientId)
    tokenBody.set('redirect_uri', initCookie.redirectUri)
    tokenBody.set('code_verifier', initCookie.codeVerifier)

    const dpopKeyPair = getOrCreateDpopKeyPair(initCookie)
    const tokenReq = await fetchWithDpop(initCookie.tokenEndpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json'
        },
        body: tokenBody.toString(),
        publicJwk: dpopKeyPair.publicJwk,
        privateJwk: dpopKeyPair.privateJwk,
        nonce: initCookie.authServerDpopNonce || null
    })
    const tokenRes = tokenReq.res

    const tokenJson = await readJsonResponse<OAuthTokenResponse & {
        error?:string;
        error_description?:string;
    }>(tokenRes)

    if (!tokenRes.ok || !tokenJson.access_token) {
        return jsonResponse({
            error: tokenJson.error || 'Token exchange failed',
            error_description: tokenJson.error_description
        }, 400)
    }

    const profile = await fetchProfile(
        initCookie,
        tokenJson.access_token,
        dpopKeyPair,
        tokenReq.nonce
    )
    const session = await makeSession(
        initCookie,
        tokenJson.access_token,
        dpopKeyPair,
        tokenReq.nonce,
        tokenJson.refresh_token
    )

    const authCookie:AuthCookie = {
        service: initCookie.pdsOrigin,
        session,
        profile,
        oauth: {
            accessToken: tokenJson.access_token,
            refreshToken: tokenJson.refresh_token || null,
            scope: tokenJson.scope || null,
            expiresIn: tokenJson.expires_in || null,
            dpopPublicJwk: dpopKeyPair.publicJwk,
            dpopPrivateJwk: dpopKeyPair.privateJwk,
            pdsDpopNonce: tokenReq.nonce,
            authServerDpopNonce: tokenReq.nonce
        },
        updatedAt: Date.now()
    }

    const headers = new Headers({
        'content-type': 'application/json; charset=utf-8'
    })
    headers.append(
        'Set-Cookie',
        cookieString(req, AUTH_COOKIE, JSON.stringify(authCookie), AUTH_TTL_SECONDS)
    )
    headers.append('Set-Cookie', clearCookie(req, OAUTH_INIT_COOKIE))

    return jsonResponse({
        session,
        service: initCookie.pdsOrigin,
        profile
    }, 200, headers)
}

async function makeSession (
    initCookie:OAuthInitCookie,
    accessToken:string,
    dpopKeyPair:{ publicJwk:DpopPublicJwk; privateJwk:DpopPrivateJwk },
    dpopNonce:string|null = null,
    refreshToken?:string
):Promise<AtpSessionData> {
    const fallback:AtpSessionData = {
        accessJwt: accessToken,
        refreshJwt: refreshToken || accessToken,
        did: initCookie.did,
        handle: initCookie.handle,
        active: true
    }

    const sessionUrl = new URL(
        '/xrpc/com.atproto.server.getSession',
        initCookie.pdsOrigin
    )
    const sessionReq = await fetchWithDpop(sessionUrl.toString(), {
        method: 'GET',
        headers: {
            accept: 'application/json'
        },
        accessToken,
        publicJwk: dpopKeyPair.publicJwk,
        privateJwk: dpopKeyPair.privateJwk,
        nonce: dpopNonce
    })
    const sessionRes = sessionReq.res

    if (!sessionRes.ok) {
        return fallback
    }

    const data = await readJsonResponse<{
        did?:string;
        handle?:string;
        email?:string;
        emailConfirmed?:boolean;
        emailAuthFactor?:boolean;
        status?:string;
    }>(sessionRes)

    return {
        ...fallback,
        did: data.did || fallback.did,
        handle: data.handle || fallback.handle,
        email: data.email,
        emailConfirmed: data.emailConfirmed,
        emailAuthFactor: data.emailAuthFactor,
        status: data.status
    }
}

async function fetchProfile (
    initCookie:OAuthInitCookie,
    accessToken:string,
    dpopKeyPair:{ publicJwk:DpopPublicJwk; privateJwk:DpopPrivateJwk },
    dpopNonce:string|null = null
):Promise<Profile|null> {
    const actor = initCookie.did || initCookie.handle
    const profileUrl = new URL('/xrpc/app.bsky.actor.getProfile', initCookie.pdsOrigin)
    profileUrl.searchParams.set('actor', actor)

    const profileReq = await fetchWithDpop(profileUrl.toString(), {
        method: 'GET',
        headers: {
            accept: 'application/json'
        },
        accessToken,
        publicJwk: dpopKeyPair.publicJwk,
        privateJwk: dpopKeyPair.privateJwk,
        nonce: dpopNonce
    })
    const res = profileReq.res

    if (!res.ok) {
        return {
            did: initCookie.did,
            handle: initCookie.handle,
            avatar: ''
        }
    }

    const data = await readJsonResponse<{
        did?:string;
        handle?:string;
        avatar?:string;
    }>(res)

    return {
        did: data.did || initCookie.did,
        handle: data.handle || initCookie.handle,
        avatar: data.avatar || ''
    }
}

function authStatus (req:Request):Response {
    const auth = readCookieJson<AuthCookie>(req, AUTH_COOKIE)
    if (!auth?.session?.accessJwt) {
        return jsonResponse({
            registered: false,
            authenticated: false,
            profile: null
        })
    }

    return jsonResponse({
        registered: true,
        authenticated: true,
        profile: auth.profile || null
    })
}

function authSession (req:Request):Response {
    const auth = readCookieJson<AuthCookie>(req, AUTH_COOKIE)
    if (!auth?.session) {
        return jsonResponse({ session: null, service: null })
    }

    return jsonResponse({
        session: auth.session,
        service: auth.service
    })
}

function authLogout (req:Request):Response {
    const headers = new Headers({
        'content-type': 'application/json; charset=utf-8'
    })
    headers.append('Set-Cookie', clearCookie(req, AUTH_COOKIE))
    headers.append('Set-Cookie', clearCookie(req, OAUTH_INIT_COOKIE))
    return jsonResponse({ ok: true }, 200, headers)
}

async function authXrpc (req:Request, subpath:string):Promise<Response> {
    const auth = readCookieJson<AuthCookie>(req, AUTH_COOKIE)
    if (!auth?.oauth?.accessToken || !auth?.service) {
        return jsonResponse({ error: 'Not authenticated' }, 401)
    }

    const publicJwk = asDpopPublicJwk(auth.oauth.dpopPublicJwk)
    const privateJwk = asDpopPrivateJwk(auth.oauth.dpopPrivateJwk)
    if (!publicJwk || !privateJwk) {
        return jsonResponse({
            error: 'Missing OAuth DPoP session. Please sign in again.'
        }, 401)
    }

    const requestUrl = new URL(req.url)
    const target = new URL(subpath + requestUrl.search, auth.service)
    const headers = new Headers()
    const passthroughHeaders = [
        'accept',
        'content-type',
        'atproto-accept-labelers',
        'atproto-proxy'
    ]

    for (const name of passthroughHeaders) {
        const value = req.headers.get(name)
        if (value) headers.set(name, value)
    }

    let body:BodyInit|undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await req.arrayBuffer()
        if (raw.byteLength > 0) {
            body = raw
        }
    }

    const dpopRes = await fetchWithDpop(target.toString(), {
        method: req.method,
        headers,
        body,
        accessToken: auth.oauth.accessToken,
        publicJwk,
        privateJwk,
        nonce: auth.oauth.pdsDpopNonce || null
    })

    const response = dpopRes.res
    const responseHeaders = new Headers()
    for (const [name, value] of response.headers.entries()) {
        const lower = name.toLowerCase()
        if (lower === 'content-length' || lower === 'set-cookie') continue
        responseHeaders.set(name, value)
    }

    if (dpopRes.nonce && dpopRes.nonce !== auth.oauth.pdsDpopNonce) {
        const updatedAuth:AuthCookie = {
            ...auth,
            oauth: {
                ...auth.oauth,
                pdsDpopNonce: dpopRes.nonce
            },
            updatedAt: Date.now()
        }
        responseHeaders.append(
            'Set-Cookie',
            cookieString(req, AUTH_COOKIE, JSON.stringify(updatedAuth), AUTH_TTL_SECONDS)
        )
    }

    return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: responseHeaders
    })
}

function oauthClientMetadata (req:Request):Response {
    const requestUrl = new URL(req.url)
    const scope = requestUrl.searchParams.get('scope') || DEFAULT_SCOPE
    const redirectUri = normalizeRedirectUri(
        req,
        requestUrl.searchParams.get('redirect_uri') || OAUTH_CALLBACK_PATH
    )
    const clientName = process.env.BSKY_OAUTH_CLIENT_NAME || 'Drerings'
    const origin = requestOrigin(req)
    const clientId = requestUrl.toString()

    return jsonResponse({
        client_id: clientId,
        client_name: clientName,
        client_uri: origin,
        application_type: 'web',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        redirect_uris: [redirectUri],
        scope,
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true
    })
}
