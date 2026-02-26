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

function makeAgent (searchPosts:Mock):any {
    return {
        app: {
            bsky: {
                feed: {
                    searchPosts
                }
            }
        }
    }
}

let stateMod:any

describe('State.fetchFeed', () => {
    let searchPostsSpy:Mock

    beforeEach(async () => {
        stateMod = await import('../src/state')
        vi.clearAllMocks()
        searchPostsSpy = vi.fn()
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
        searchPostsSpy.mockResolvedValue({
            data: {
                posts,
                cursor: 'cursor-abc'
            }
        })

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)

        expect(searchPostsSpy).toHaveBeenCalledTimes(1)
        expect(searchPostsSpy).toHaveBeenCalledWith({
            q: '#drering',
            sort: 'latest',
            limit: 30
        })
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.data).toEqual(posts)
        expect(state.feedReq.value.error).toBeNull()
        expect(state.feedCursor.value).toBe('cursor-abc')
    })

    it('sets pending to true while fetching', async () => {
        let resolveSearch:(arg:any)=>void
        searchPostsSpy.mockReturnValue(new Promise(resolve => {
            resolveSearch = resolve
        }))

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        const promise = stateMod.State.fetchFeed(state)

        expect(state.feedReq.value.pending).toBe(true)

        resolveSearch!({
            data: { posts: [], cursor: null }
        })
        await promise

        expect(state.feedReq.value.pending).toBe(false)
    })

    it('deduplicates concurrent requests', async () => {
        searchPostsSpy.mockResolvedValue({
            data: {
                posts: [makeFeedPost()],
                cursor: null
            }
        })

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        const p1 = stateMod.State.fetchFeed(state)
        const p2 = stateMod.State.fetchFeed(state)

        await Promise.all([p1, p2])

        expect(searchPostsSpy).toHaveBeenCalledTimes(1)
    })

    it('allows a new request after previous completes',
        async () => {
            searchPostsSpy.mockResolvedValue({
                data: {
                    posts: [makeFeedPost()],
                    cursor: null
                }
            })

            const state = stateMod.State()
            state.agent.value = makeAgent(searchPostsSpy)
            await stateMod.State.fetchFeed(state)
            await stateMod.State.fetchFeed(state)

            expect(searchPostsSpy).toHaveBeenCalledTimes(2)
        }
    )

    it('loads more posts with cursor and appends', async () => {
        const firstPosts = [makeFeedPost({ cid: 'first' })]
        const morePosts = [makeFeedPost({ cid: 'second' })]

        searchPostsSpy
            .mockResolvedValueOnce({
                data: {
                    posts: firstPosts,
                    cursor: 'page-2'
                }
            })
            .mockResolvedValueOnce({
                data: {
                    posts: morePosts,
                    cursor: null
                }
            })

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)
        await stateMod.State.fetchFeed(state, true)

        expect(searchPostsSpy).toHaveBeenCalledTimes(2)
        expect(searchPostsSpy.mock.calls[1][0]).toEqual({
            q: '#drering',
            sort: 'latest',
            limit: 30,
            cursor: 'page-2'
        })
        expect(state.feedReq.value.data).toEqual([
            ...firstPosts,
            ...morePosts
        ])
        expect(state.feedCursor.value).toBeNull()
    })

    it('stores error in feedReq on rpc failure', async () => {
        searchPostsSpy.mockRejectedValue(
            new Error('searchPosts failed (500)')
        )

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)

        expect(searchPostsSpy).toHaveBeenCalledTimes(1)
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error).toBeInstanceOf(Error)
        expect(state.feedReq.value.error?.message)
            .toMatch(/500/)
        expect(state.feedReq.value.data).toBeNull()
    })

    it('requires login when auth agent is unavailable', async () => {
        const state = stateMod.State()
        await stateMod.State.fetchFeed(state)

        expect(mockClient.initRestore).toHaveBeenCalledTimes(1)
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error?.message)
            .toBe('You need to log in before loading feed.')
        expect(state.feedReq.value.data).toBeNull()
    })

    it('shows missing scope error without triggering reauth redirect', async () => {
        searchPostsSpy.mockRejectedValue(
            new Error(
                'Missing required scope ' +
                '"rpc:app.bsky.feed.searchPosts?aud=did:web:api.bsky.app"'
            )
        )

        const state = stateMod.State()
        state.profile.value = {
            did: 'did:plc:alice',
            handle: 'alice.bsky.app',
            avatar: ''
        }
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)

        expect(searchPostsSpy).toHaveBeenCalledTimes(1)
        expect(mockClient.signInRedirect).not.toHaveBeenCalled()
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error?.message)
            .toContain('Missing required scope')
        expect(state.feedReq.value.data).toBeNull()
    })

    it('stores error on network failure', async () => {
        searchPostsSpy.mockRejectedValue(
            new Error('Network error')
        )

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)

        expect(searchPostsSpy).toHaveBeenCalledTimes(1)
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.error?.message)
            .toBe('Network error')
    })
})
