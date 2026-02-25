import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock
} from 'vitest'

const {
    mockClient,
    mockGetOAuthClient,
    mockSetAgentFromOAuthSession,
    mockOauthRedirectUri
} = vi.hoisted(() => {
    const mockClient = {
        initRestore: vi.fn(),
        signInRedirect: vi.fn(),
        initCallback: vi.fn(),
        restore: vi.fn(),
        revoke: vi.fn()
    }

    const mockGetOAuthClient = vi.fn(async () => mockClient)
    const mockSetAgentFromOAuthSession = vi.fn(
        async () => {}
    )
    const mockOauthRedirectUri = vi.fn(
        () => 'http://127.0.0.1:8888/login'
    )

    return {
        mockClient,
        mockGetOAuthClient,
        mockSetAgentFromOAuthSession,
        mockOauthRedirectUri
    }
})

vi.mock('../src/util', () => ({
    getOAuthClient: mockGetOAuthClient,
    setAgentFromOAuthSession: mockSetAgentFromOAuthSession,
    oauthRedirectUri: mockOauthRedirectUri
}))

const SEARCH_ENDPOINT =
    'https://public.api.bsky.app/xrpc/' +
    'app.bsky.feed.searchPosts'

function makeFeedPost (overrides:Partial<any> = {}) {
    return {
        uri: 'at://did:plc:alice/app.bsky.feed.post/abc',
        cid: 'bafy-cid',
        author: {
            did: 'did:plc:alice',
            handle: 'alice.bsky.social',
            displayName: 'Alice',
            avatar: 'https://example.com/avatar.png'
        },
        record: {
            text: 'hello drering',
            createdAt: '2026-01-01T00:00:00.000Z'
        },
        ...overrides
    }
}

let stateMod:any

describe('State.fetchFeed', () => {
    let fetchSpy:Mock

    beforeEach(async () => {
        stateMod = await import('../src/state')
        vi.clearAllMocks()

        fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
    })

    it('exposes feedReq on State() return value', () => {
        const state = stateMod.State()
        expect(state.feedReq).toBeDefined()
        expect(state.feedReq.value).toEqual({
            pending: false,
            data: null,
            error: null
        })
    })

    it('exposes feedCursor on State() return value', () => {
        const state = stateMod.State()
        expect(state.feedCursor).toBeDefined()
        expect(state.feedCursor.value).toBeNull()
    })

    it('fetches posts and stores them in feedReq', async () => {
        const posts = [makeFeedPost(), makeFeedPost({
            cid: 'bafy-cid-2',
            uri: 'at://did:plc:bob/app.bsky.feed.post/def'
        })]
        fetchSpy.mockResolvedValue({
            ok: true,
            json: async () => ({
                posts,
                cursor: 'cursor-abc'
            })
        })

        const state = stateMod.State()
        await stateMod.State.fetchFeed(state)

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const calledUrl = new URL(fetchSpy.mock.calls[0][0])
        expect(calledUrl.origin + calledUrl.pathname)
            .toBe(SEARCH_ENDPOINT)
        expect(calledUrl.searchParams.get('q'))
            .toBe('#drering')

        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.data).toEqual(posts)
        expect(state.feedReq.value.error).toBeNull()
        expect(state.feedCursor.value).toBe('cursor-abc')
    })

    it('sets pending to true while fetching', async () => {
        let resolveFetch:Function
        fetchSpy.mockReturnValue(new Promise(resolve => {
            resolveFetch = resolve
        }))

        const state = stateMod.State()
        const promise = stateMod.State.fetchFeed(state)

        expect(state.feedReq.value.pending).toBe(true)

        resolveFetch!({
            ok: true,
            json: async () => ({ posts: [], cursor: null })
        })
        await promise

        expect(state.feedReq.value.pending).toBe(false)
    })

    it('deduplicates concurrent requests', async () => {
        fetchSpy.mockResolvedValue({
            ok: true,
            json: async () => ({
                posts: [makeFeedPost()],
                cursor: null
            })
        })

        const state = stateMod.State()
        const p1 = stateMod.State.fetchFeed(state)
        const p2 = stateMod.State.fetchFeed(state)

        await Promise.all([p1, p2])

        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('allows a new request after previous completes',
        async () => {
            fetchSpy.mockResolvedValue({
                ok: true,
                json: async () => ({
                    posts: [makeFeedPost()],
                    cursor: null
                })
            })

            const state = stateMod.State()
            await stateMod.State.fetchFeed(state)
            await stateMod.State.fetchFeed(state)

            expect(fetchSpy).toHaveBeenCalledTimes(2)
        }
    )

    it('loads more posts with cursor and appends', async () => {
        const firstPosts = [makeFeedPost({ cid: 'first' })]
        const morePosts = [makeFeedPost({ cid: 'second' })]

        fetchSpy
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    posts: firstPosts,
                    cursor: 'page-2'
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    posts: morePosts,
                    cursor: null
                })
            })

        const state = stateMod.State()
        await stateMod.State.fetchFeed(state)
        await stateMod.State.fetchFeed(state, true)

        expect(fetchSpy).toHaveBeenCalledTimes(2)
        const secondUrl = new URL(fetchSpy.mock.calls[1][0])
        expect(secondUrl.searchParams.get('cursor'))
            .toBe('page-2')
        expect(state.feedReq.value.data).toEqual([
            ...firstPosts,
            ...morePosts
        ])
        expect(state.feedCursor.value).toBeNull()
    })

    it('stores error in feedReq on fetch failure', async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 500
        })

        const state = stateMod.State()
        await stateMod.State.fetchFeed(state)

        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error).toBeInstanceOf(Error)
        expect(state.feedReq.value.error?.message)
            .toMatch(/500/)
        expect(state.feedReq.value.data).toBeNull()
    })

    it('stores error on network failure', async () => {
        fetchSpy.mockRejectedValue(
            new Error('Network error')
        )

        const state = stateMod.State()
        await stateMod.State.fetchFeed(state)

        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error?.message)
            .toBe('Network error')
    })
})
