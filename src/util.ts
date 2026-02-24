import type {
    BrowserOAuthClient as BrowserOAuthClientType
} from '@atproto/oauth-client-browser'
import type { OAuthSession } from '@atproto/oauth-client'
import type { AppState } from './state'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:util')
export const OAUTH_CALLBACK_PATH = '/login'
export const OAUTH_SCOPE = 'atproto transition:generic'
export const HANDLE_RESOLVER_URL = 'https://bsky.social'

let oauthClientPromise:Promise<BrowserOAuthClientType>|null = null

export function paramsFromQueryLike (query:string):URLSearchParams {
    return new URLSearchParams(query.replace(/^[?#]/, ''))
}

export function oauthParamsFromUrlLike (urlLike:URL|string):URLSearchParams {
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

export function oauthRedirectUri ():string {
    const redirect = new URL(OAUTH_CALLBACK_PATH, window.location.origin)

    // Bluesky local OAuth callbacks should use 127.0.0.1, not localhost.
    if (redirect.hostname === 'localhost') {
        redirect.hostname = '127.0.0.1'
    }

    return redirect.toString()
}

export function isLoopbackHost (hostname:string):boolean {
    return hostname === '127.0.0.1' ||
        hostname === 'localhost' ||
        hostname === '::1' ||
        hostname === '[::1]'
}

export function oauthClientId ():string {
    const redirectUri = oauthRedirectUri()
    const scope = OAUTH_SCOPE
    const hostname = new URL(redirectUri).hostname

    if (isLoopbackHost(hostname)) {
        const clientId = new URL('http://localhost')
        clientId.searchParams.set('redirect_uri', redirectUri)
        clientId.searchParams.set('scope', scope)
        return clientId.toString()
    }

    const clientId = new URL('/api/auth/oauth/client-metadata', window.location.origin)
    clientId.searchParams.set('redirect_uri', redirectUri)
    clientId.searchParams.set('scope', scope)
    return clientId.toString()
}

export async function getOAuthClient ():Promise<BrowserOAuthClientType> {
    if (!oauthClientPromise) {
        oauthClientPromise = (async () => {
            const { BrowserOAuthClient } = await import(
                '@atproto/oauth-client-browser'
            )
            return BrowserOAuthClient.load({
                clientId: oauthClientId(),
                responseMode: 'query',
                handleResolver: HANDLE_RESOLVER_URL
            })
        })()
    }

    return oauthClientPromise
}

export async function setAgentFromOAuthSession (
    state:AppState,
    session:OAuthSession
):Promise<void> {
    const { Agent: AtprotoAgent } = await import('@atproto/api')
    const agent = new AtprotoAgent(session)
    state.agent.value = agent

    try {
        const profile = await agent.getProfile({ actor: session.did })
        state.profile.value = {
            did: profile.data.did || session.did,
            handle: profile.data.handle || '',
            avatar: profile.data.avatar || ''
        }
    } catch (err) {
        debug('profile hydrate error', err)
        state.profile.value = {
            did: session.did,
            handle: '',
            avatar: ''
        }
    }
}

/**
 * True when URL looks like an OAuth callback redirect.
 */
export const hasOAuthCallback = function (query:URLSearchParams|string):boolean {
    const params = typeof query === 'string' ?
        new URLSearchParams(query.replace(/^\?/, '')) :
        query
    return (
        params.has('state') &&
        (params.has('code') || params.has('error'))
    )
}

/**
 * Read OAuth callback params from current location search + hash.
 */
export const readOAuthParamsFromLocation = function (
    locationHref:string = window.location.href
):URLSearchParams {
    return oauthParamsFromUrlLike(locationHref)
}
