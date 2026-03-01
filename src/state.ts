import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import { Agent, moderatePost } from '@atproto/api'
import type {
    AppBskyFeedDefs,
    AppBskyFeedSearchPosts,
    AppBskyEmbedImages,
    BlobRef,
} from '@atproto/api'
import type { OAuthRedirectUri, OAuthSession } from '@atproto/oauth-client'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import {
    getOAuthClient,
    oauthRedirectUri,
} from './util'
const debug = Debug('drerings:state')

export const OAUTH_CALLBACK_PATH = '/login'
export const OAUTH_SCOPE = 'atproto transition:generic'
export const HANDLE_RESOLVER_URL = 'https://bsky.social'
export const INVISIBLE_POST_TAG = 'drering'

export { RequestState, type RequestFor }

export type FeedPost = AppBskyFeedDefs.PostView

export type FeedImage = AppBskyEmbedImages.ViewImage
export type FeedPageDirection = 'next'|'prev'
export type FeedLikeCounts = Record<string, number>

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
    postReq:Signal<RequestFor<
        { uri:string, cid:string }, Error
    >>;
    feedReq:Signal<RequestFor<FeedPost[], Error>>;
    feedCursor:Signal<string|null>;
    feedPageIndex:Signal<number>;
    feedPageCursors:Signal<Array<string|null>>;
    feedLikeCounts:Signal<FeedLikeCounts>;
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
            RequestState()
        ),
        feedReq: signal<RequestFor<FeedPost[], Error>>(
            RequestState()
        ),
        feedCursor: signal<string|null>(null),
        feedPageIndex: signal<number>(0),
        feedPageCursors: signal<Array<string|null>>([null]),
        feedLikeCounts: signal<FeedLikeCounts>({}),
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
        // handle hash clicks
        if (path.includes('#')) {
            // assuming link is like '#link'
            const href = path.split('#').pop()!
            debug('the href...', href)
            return document.getElementById(href)?.scrollIntoView()
        }

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
    imageBlob?:Blob,
    altText?:string
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
            tags:string[];
            embed?:{
                $type:'app.bsky.embed.images';
                images:Array<{
                    alt:string;
                    image:BlobRef;
                }>;
            };
        } = {
            text,
            createdAt: new Date().toISOString(),
            tags: [INVISIBLE_POST_TAG]
        }

        if (imageBlob && imageBlob.size > 0) {
            const encoding = imageBlob.type || 'image/png'
            const bytes = new Uint8Array(await imageBlob.arrayBuffer())
            const upload = await agent.uploadBlob(bytes, { encoding })
            postRecord.embed = {
                $type: 'app.bsky.embed.images',
                images: [{
                    alt: altText || text || 'Drering',
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
        const error = err instanceof Error ?
            err :
            new Error('Failed to post to Bluesky')
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
 * Hydrate the state agent from server-provided session data.
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
 * Fetch feed posts from Bluesky search API.
 * Deduplicates: skips if a request is already in progress.
 * Pass direction to move to the next/previous page.
 */
State.fetchFeed = async function (
    state:AppState,
    direction?:FeedPageDirection
):Promise<void> {
    if (state.feedReq.value.pending) return

    const { start, error, set } = RequestState

    const req = state.feedReq
    const prevPageIndex = state.feedPageIndex.value
    const prevPageCursors = [...state.feedPageCursors.value]
    const prevFeedCursor = state.feedCursor.value
    let pageCursor:string|null = null

    if (direction === 'next') {
        const nextCursor = state.feedCursor.value
        if (!nextCursor) return
        const nextIndex = state.feedPageIndex.value + 1
        state.feedPageIndex.value = nextIndex
        const cursors = [...state.feedPageCursors.value]
        cursors[nextIndex] = nextCursor
        state.feedPageCursors.value = cursors
        pageCursor = nextCursor
    } else if (direction === 'prev') {
        if (state.feedPageIndex.value === 0) return
        const prevIndex = state.feedPageIndex.value - 1
        state.feedPageIndex.value = prevIndex
        pageCursor = state.feedPageCursors.value[prevIndex] || null
    } else {
        state.feedPageIndex.value = 0
        state.feedPageCursors.value = [null]
        state.feedCursor.value = null
    }

    state.feedLikeCounts.value = {}

    req.value = RequestState<FeedPost[]>()
    start(req)

    try {
        const agent = state.agent.value || await State.hydrateAgent(state)
        if (!agent) {
            throw new Error('You need to log in before loading feed.')
        }
        const prefs = await agent.getPreferences()

        const searchParams:{
            q:string;
            sort:'latest'|'top';
            limit:number;
            cursor?:string;
        } = {
            q: '#' + INVISIBLE_POST_TAG,
            sort: 'latest',
            limit: 20
        }

        if (pageCursor) {
            searchParams.cursor = pageCursor
        }

        const res = await agent.app.bsky.feed.searchPosts(searchParams)
        const data:AppBskyFeedSearchPosts.OutputSchema = res.data

        debug('feed search results', data)

        const visiblePosts = data.posts.filter((post) => {
            const moderation = moderatePost(post, {
                userDid: agent.did,
                prefs: prefs.moderationPrefs
            })

            // 'filter' is true if the post is blocked / muted
            return !moderation.ui('contentList').filter
        })

        state.feedCursor.value = data.cursor || null

        set(req, visiblePosts)
        await State.fetchFeedLikeCounts(state, visiblePosts)
    } catch (_err) {
        const err = (_err instanceof Error ?
            _err :
            new Error('Failed to load feed'))

        state.feedPageIndex.value = prevPageIndex
        state.feedPageCursors.value = prevPageCursors
        state.feedCursor.value = prevFeedCursor
        state.feedLikeCounts.value = {}

        debug('feed fetch error', err)
        error(req, err)
    }
}

State.fetchFeedLikeCounts = async function (
    state:AppState,
    posts:FeedPost[]
):Promise<void> {
    const uris = [...new Set(posts
        .map(post => post.uri)
        .filter((uri):uri is string => typeof uri === 'string' && !!uri))]

    if (!uris.length) {
        state.feedLikeCounts.value = {}
        return
    }

    try {
        const url = new URL('/api/constellation/likes', window.location.origin)
        uris.forEach((uri) => {
            url.searchParams.append('uri', uri)
        })

        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/json'
            }
        })

        if (!res.ok) {
            throw new Error(`Failed to fetch like counts (${res.status})`)
        }

        const body = await res.json() as {
            counts?:Record<string, unknown>;
        }
        const counts:Record<string, unknown> = (
            body &&
            (typeof body === 'object' && body.counts &&
                typeof body.counts === 'object') ? body.counts : {}
        )

        const nextCounts:FeedLikeCounts = {}
        uris.forEach((uri) => {
            const raw = counts[uri]
            if (typeof raw !== 'number' || !Number.isFinite(raw)) return
            nextCounts[uri] = raw
        })

        state.feedLikeCounts.value = nextCounts
    } catch (err) {
        debug('feed like counts error', err)
        state.feedLikeCounts.value = {}
    }
}

State.blockProfile = async function (state:AppState, did:string) {
    const agent = state.agent.value
    if (!agent) throw new Error('not agent')
    const repoDid:string = (state.profile.value?.did || agent.did)!

    await agent.app.bsky.graph.block.create(
        { repo: repoDid },
        {
            $type: 'app.bsky.graph.block',
            subject: did,
            createdAt: new Date().toISOString()
        }
    )
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

export async function setAgentFromOAuthSession (
    state:AppState,
    session:OAuthSession
):Promise<void> {
    const agent = new Agent(session)
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
