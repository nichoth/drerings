import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import type { Agent } from '@atproto/api'
import type { OAuthRedirectUri } from '@atproto/oauth-client'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import {
    getOAuthClient,
    setAgentFromOAuthSession,
    oauthRedirectUri,
} from './util'
const debug = Debug('drerings:state')
export const OAUTH_CALLBACK_PATH = '/login'
export const OAUTH_SCOPE = 'atproto transition:generic'
export const HANDLE_RESOLVER_URL = 'https://bsky.social'

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
    postReq:Signal<RequestFor<{ uri:string, cid:string }, Error>>;
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
        postReq: signal<RequestFor<{ uri:string, cid:string }, Error>>(
            RequestState<{ uri:string, cid:string }>()
        ),
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

State.post = async function (
    state:AppState,
    textContent?:string,
    imageBlob?:Blob
) {
    const req = state.postReq
    req.value = RequestState<{ uri:string, cid:string }>()
    RequestState.start(req)
    try {
        let agent = state.agent.value
        if (!agent) {
            agent = await State.hydrateAgent(state)
        }
        if (!agent) {
            throw new Error('You need to log in before posting.')
        }

        const text = (textContent || '').trim() ||
            `New drering from @${state.profile.value?.handle || 'unknown'}`
        const postRecord:{
            text:string;
            createdAt:string;
            embed?:{
                $type:'app.bsky.embed.images';
                images:Array<{
                    alt:string;
                    image:unknown;
                }>;
            };
        } = {
            text,
            createdAt: new Date().toISOString()
        }

        if (imageBlob && imageBlob.size > 0) {
            const encoding = imageBlob.type || 'image/png'
            const bytes = new Uint8Array(await imageBlob.arrayBuffer())
            const upload = await agent.uploadBlob(bytes, { encoding })
            postRecord.embed = {
                $type: 'app.bsky.embed.images',
                images: [{
                    alt: text || 'Drering',
                    image: upload.data.blob
                }]
            }
        }

        const post = await agent.post(postRecord)

        debug('done posting', post)

        RequestState.set(req, {
            uri: post.uri,
            cid: post.cid
        })

        return post
    } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to post to Bluesky')
        RequestState.error(req, error)
        throw error
    }
}

State.fetchAuthStatus = async function (state:AppState):Promise<AuthStatus> {
    state.authLoading.value = true
    try {
        const client = await getOAuthClient()
        const restored = await client.initRestore()

        if (!restored?.session) {
            state.auth.value = {
                registered: false,
                authenticated: false
            }
            state.profile.value = null
            state.agent.value = null
            return state.auth.value
        }

        await setAgentFromOAuthSession(state, restored.session)
        state.auth.value = {
            registered: true,
            authenticated: true
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
State.login = async function (_state:AppState, handle:string):Promise<void> {
    const normalizedHandle = handle.trim()
    if (!normalizedHandle) {
        throw new Error('Bluesky handle is required')
    }

    const client = await getOAuthClient()
    await client.signInRedirect(normalizedHandle, {
        scope: OAUTH_SCOPE,
        redirect_uri: oauthRedirectUri() as OAuthRedirectUri
    })
}

/**
 * Finish OAuth after redirecting back to the app.
 */
State.finishOAuth = async function (
    state:AppState,
    query:URLSearchParams|string
):Promise<void> {
    const client = await getOAuthClient()
    const params = typeof query === 'string' ?
        new URLSearchParams(query.replace(/^[?#]/, '')) :
        query

    const uri = oauthRedirectUri() as OAuthRedirectUri
    const result = await client.initCallback(params, uri)
    await setAgentFromOAuthSession(state, result.session)
    state.auth.value = {
        registered: true,
        authenticated: true
    }
}

/**
 * Build an agent from a pre-existing session.
 */
State.createAgent = async function (
    state:AppState,
    did:string,
    service?:string
):Promise<void> {
    const client = await getOAuthClient()
    const session = await client.restore(did)
    if (service) debug('ignoring service for oauth agent restore', service)
    await setAgentFromOAuthSession(state, session)
}

/**
 * Optionally hydrate the state agent from server-provided session data.
 */
State.hydrateAgent = async function (state:AppState):Promise<Agent|null> {
    try {
        const client = await getOAuthClient()
        const restored = await client.initRestore()
        if (!restored?.session) return null
        await setAgentFromOAuthSession(state, restored.session)
        state.auth.value = {
            registered: true,
            authenticated: true
        }
        return state.agent.value
    } catch (err) {
        debug('hydrate agent error', err)
        return null
    }
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
        const did = state.profile.value?.did || state.agent.value?.did
        const client = await getOAuthClient()
        if (did) {
            await client.revoke(did)
        } else {
            const restored = await client.initRestore(false)
            if (restored?.session) {
                await restored.session.signOut()
            }
        }
        state.auth.value = { registered: false, authenticated: false }
        state.profile.value = null
        state.agent.value = null
        state.postReq.value = RequestState<{ uri:string, cid:string }>()
    } catch (err) {
        debug('logout error', err)
    }
}
