import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import type { Agent, AtpSessionData } from '@atproto/api'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import ky from 'ky'
const debug = Debug('drerings:state')
const DEFAULT_BSKY_SERVICE = 'https://bsky.social'
const OAUTH_CALLBACK_PATH = '/login'

export { RequestState, type RequestFor }

export interface AuthStatus {
    registered:boolean;
    authenticated:boolean;
}

export const AUTH_ROUTES:string[] = ([
    '/repos',
    import.meta.env.VITE_ALLOW_ANON_READS ? null : ['/', '/lookup']
]).filter(Boolean).flat()

export interface UserState {
    did:string;
    handle:string;
    avatar:string;
}

/**
 * Setup any state
 *   - routes
 */
export function State ():{
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
    agent:Signal<Agent|null>;
    profile:Signal<UserState|null>;
    _setRoute:(path:string)=>void;
} {  // eslint-disable-line indent
    const onRoute = Route()

    const state = {
        _setRoute: onRoute.setRoute.bind(onRoute),
        authLoading: signal<boolean>(false),
        auth: signal({
            registered: false,
            authenticated: false
        }),
        agent: signal<Agent|null>(null),
        profile: signal<UserState|null>(null),
        route: signal<string>(location.pathname + location.search),
        isAuthed: computed<boolean>(() => {
            return !!state.auth.value?.authenticated
        })
    }

    /**
     * set the app state to match the browser URL
     */
    onRoute((path:string, data) => {
        state.route.value = path.split('?').shift()
        // handle scroll state like a web browser
        // (restore scroll position on back/forward)
        if (data.popstate) {
            return window.scrollTo(data.scrollX, data.scrollY)
        }
        // if this was a link click (not back button), then scroll to top
        window.scrollTo(0, 0)
    })

    return state
}

export type AppState = ReturnType<typeof State>

type AuthStatusResponse = Partial<AuthStatus> & {
    profile?:UserState|null;
}

type OAuthStartResponse = {
    authorizeUrl?:string;
    url?:string;
}

type OAuthFinishResponse = {
    session?:AtpSessionData|null;
    service?:string;
    profile?:UserState|null;
}

function paramsFromQueryLike (query:string):URLSearchParams {
    return new URLSearchParams(query.replace(/^[?#]/, ''))
}

function oauthParamsFromUrlLike (urlLike:URL|string):URLSearchParams {
    const url = typeof urlLike === 'string' ?
        new URL(urlLike, window.location.origin) :
        urlLike

    const params = paramsFromQueryLike(url.search)
    const rawHash = url.hash.replace(/^#/, '')
    if (!rawHash) return params

    const hashQuery = rawHash.includes('?') ?
        rawHash.split('?').slice(1).join('?') :
        rawHash

    const hashParams = paramsFromQueryLike(hashQuery)
    for (const [key, value] of hashParams.entries()) {
        if (!params.has(key)) params.set(key, value)
    }

    return params
}

function oauthRedirectUri ():string {
    const redirect = new URL(OAUTH_CALLBACK_PATH, window.location.origin)

    // Bluesky local OAuth callbacks should use 127.0.0.1, not localhost.
    if (redirect.hostname === 'localhost') {
        redirect.hostname = '127.0.0.1'
    }

    return redirect.toString()
}

async function setAgentFromSession (
    state:AppState,
    session:AtpSessionData,
    service:string = DEFAULT_BSKY_SERVICE
):Promise<void> {
    const { AtpAgent } = await import('@atproto/api')
    const agent = new AtpAgent({ service })
    await agent.resumeSession(session)
    state.agent.value = agent
}

State.fetchAuthStatus = async function (state:AppState):Promise<AuthStatus> {
    state.authLoading.value = true
    try {
        const authStatus = await ky.get('/api/auth/status')
            .json<AuthStatusResponse>()

        state.auth.value = {
            registered: !!authStatus?.registered,
            authenticated: !!authStatus?.authenticated
        }
        state.profile.value = authStatus?.profile || null

        if (state.auth.value.authenticated && !state.agent.value) {
            await State.hydrateAgent(state)
        }

        return state.auth.value
    } catch (err) {
        debug('fetch auth status error', err)
        throw err
    } finally {
        state.authLoading.value = false
    }
}

/**
 * Start OAuth with Bluesky.
 */
State.login = async function (state:AppState, handle:string):Promise<void> {
    const normalizedHandle = handle.trim()
    if (!normalizedHandle) {
        throw new Error('Bluesky handle is required')
    }

    const res = await ky.post('/api/auth/oauth/start', {
        json: {
            handle: normalizedHandle,
            redirectTo: oauthRedirectUri()
        }
    }).json<OAuthStartResponse>()

    const authorizeUrl = res.authorizeUrl || res.url
    if (!authorizeUrl) {
        throw new Error('OAuth start response did not include an authorize URL')
    }

    window.location.assign(authorizeUrl)
}

/**
 * Finish OAuth after redirecting back to the app.
 */
State.finishOAuth = async function (
    state:AppState,
    query:URLSearchParams|string
):Promise<void> {
    const queryString = typeof query === 'string' ?
        query.replace(/^\?/, '') :
        query.toString()

    const res = await ky.post('/api/auth/oauth/finish', {
        json: {
            query: queryString,
            redirectTo: oauthRedirectUri()
        }
    }).json<OAuthFinishResponse>()

    if (res?.session) {
        try {
            await setAgentFromSession(
                state,
                res.session,
                res.service || DEFAULT_BSKY_SERVICE
            )
        } catch (err) {
            debug('set agent from oauth session error', err)
        }
    }

    if (res?.profile) {
        state.profile.value = res.profile
    }

    await State.fetchAuthStatus(state)
}

/**
 * Build an agent from a pre-existing session.
 */
State.createAgent = async function (
    state:AppState,
    session:AtpSessionData,
    service?:string
):Promise<void> {
    await setAgentFromSession(state, session, service || DEFAULT_BSKY_SERVICE)
}

/**
 * Optionally hydrate the state agent from server-provided session data.
 */
State.hydrateAgent = async function (state:AppState):Promise<Agent|null> {
    try {
        const res = await ky.get('/api/auth/session')
            .json<{ session?:AtpSessionData|null; service?:string }>()
        if (!res?.session) return null
        await setAgentFromSession(
            state,
            res.session,
            res.service || DEFAULT_BSKY_SERVICE
        )
        return state.agent.value
    } catch (err) {
        debug('hydrate agent error', err)
        return null
    }
}

/**
 * True when URL looks like an OAuth callback redirect.
 */
State.hasOAuthCallback = function (query:URLSearchParams|string):boolean {
    const params = typeof query === 'string' ?
        new URLSearchParams(query.replace(/^\?/, '')) :
        query
    return (
        params.has('code') ||
        params.has('error') ||
        (params.has('state') && params.has('iss'))
    )
}

/**
 * Read OAuth callback params from current location search + hash.
 */
State.readOAuthParamsFromLocation = function (
    locationHref:string = window.location.href
):URLSearchParams {
    return oauthParamsFromUrlLike(locationHref)
}

/**
 * Get OAuth callback error message from query params.
 */
State.readOAuthError = function (query:URLSearchParams|string):string|null {
    const params = typeof query === 'string' ?
        new URLSearchParams(query.replace(/^\?/, '')) :
        query
    const error = params.get('error')
    if (!error) return null
    return params.get('error_description') || error
}

/**
 * Clear current OAuth callback params from browser URL.
 */
State.clearOAuthQuery = function ():void {
    if (!window.location.search && !window.location.hash) return
    const clean = new URL(window.location.href)
    clean.search = ''
    clean.hash = ''
    window.history.replaceState(null, '', clean.pathname)
}

/**
 * Logout
 */
State.Logout = async function (state:AppState):Promise<void> {
    try {
        await ky.post('/api/auth/logout')
        state.auth.value = { registered: true, authenticated: false }
        state.profile.value = null
        state.agent.value = null
    } catch (err) {
        debug('logout error', err)
    }
}
