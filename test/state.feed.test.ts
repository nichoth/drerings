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
    mockOauthRedirectUri,
    mockFetch
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
    const mockFetch = vi.fn()

    return {
        mockClient,
        mockGetOAuthClient,
        mockSetAgentFromOAuthSession,
        mockOauthRedirectUri,
        mockFetch
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

function makeAgent (
    searchPosts:Mock,
    {
        did = 'did:plc:self',
        moderationPrefs = {}
    }:{
        did?:string;
        moderationPrefs?:any;
    } = {}
):any {
    return {
        did,
        getPreferences: vi.fn(async () => ({
            moderationPrefs
        })),
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
        vi.stubGlobal('fetch', mockFetch as any)
        mockFetch.mockResolvedValue({
            ok: true,
            json: vi.fn(async () => ({ counts: {} }))
        })
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

    it('exposes feedLikeCounts on State() return value', () => {
        const state = stateMod.State()
        expect(state.feedLikeCounts).toBeDefined()
        expect(state.feedLikeCounts.value).toEqual({})
    })

    it('exposes feedPageIndex on State() return value', () => {
        const state = stateMod.State()
        expect(state.feedPageIndex).toBeDefined()
        expect(state.feedPageIndex.value).toBe(0)
    })

    it('exposes feedPageCursors on State() return value', () => {
        const state = stateMod.State()
        expect(state.feedPageCursors).toBeDefined()
        expect(state.feedPageCursors.value).toEqual([null])
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
            limit: 20
        })
        expect(state.feedReq.value.pending).toBe(false)
        expect(state.feedReq.value.data).toEqual(posts)
        expect(state.feedReq.value.error).toBeNull()
        expect(state.feedCursor.value).toBe('cursor-abc')
    })

    it('fetches like counts from constellation API for visible posts',
        async () => {
            const posts = [makeFeedPost({
                cid: 'post-like-count-1',
                uri: 'at://did:plc:alice/app.bsky.feed.post/likecount1'
            })]
            searchPostsSpy.mockResolvedValue({
                data: {
                    posts,
                    cursor: null
                }
            })
            mockFetch.mockResolvedValue({
                ok: true,
                json: vi.fn(async () => ({
                    counts: {
                        'at://did:plc:alice/app.bsky.feed.post/likecount1': 7
                    }
                }))
            })

            const state = stateMod.State()
            state.agent.value = makeAgent(searchPostsSpy)
            await stateMod.State.fetchFeed(state)

            expect(mockFetch).toHaveBeenCalledTimes(1)
            expect(mockFetch.mock.calls[0][0])
                .toContain('/api/constellation/likes?')
            expect(mockFetch.mock.calls[0][0]).toContain(
                'uri=at%3A%2F%2Fdid%3Aplc%3Aalice%2Fapp.bsky.feed.post%2Flikecount1'
            )
            expect(state.feedLikeCounts.value).toEqual({
                'at://did:plc:alice/app.bsky.feed.post/likecount1': 7
            })
        })

    it('filters out posts from blocked accounts', async () => {
        const visible = makeFeedPost({ cid: 'visible-cid' })
        const blocked = makeFeedPost({
            cid: 'blocked-cid',
            author: {
                did: 'did:plc:blocked',
                handle: 'blocked.bsky.social',
                displayName: 'Blocked',
                avatar: 'https://example.com/blocked.png',
                viewer: {
                    blocking: 'at://did:plc:self/app.bsky.graph.block/abc'
                }
            }
        })
        const blockedByList = makeFeedPost({
            cid: 'blocked-list-cid',
            author: {
                did: 'did:plc:blocked-list',
                handle: 'blockedlist.bsky.social',
                displayName: 'Blocked List',
                avatar: 'https://example.com/blocked-list.png',
                viewer: {
                    blocking: 'at://did:plc:self/app.bsky.graph.block/def',
                    blockingByList: {
                        uri: 'at://did:plc:self/app.bsky.graph.list/list1'
                    }
                }
            }
        })

        searchPostsSpy.mockResolvedValue({
            data: {
                posts: [visible, blocked, blockedByList],
                cursor: null
            }
        })

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)

        expect(state.feedReq.value.data).toEqual([visible])
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

    it('loads next page with cursor and replaces data', async () => {
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
        await stateMod.State.fetchFeed(state, 'next')

        expect(searchPostsSpy).toHaveBeenCalledTimes(2)
        expect(searchPostsSpy.mock.calls[1][0]).toEqual({
            q: '#drering',
            sort: 'latest',
            limit: 20,
            cursor: 'page-2'
        })
        expect(state.feedReq.value.data).toEqual(morePosts)
        expect(state.feedPageIndex.value).toBe(1)
        expect(state.feedPageCursors.value).toEqual([null, 'page-2'])
        expect(state.feedCursor.value).toBeNull()
    })

    it('loads previous page using stored cursors', async () => {
        const firstPosts = [makeFeedPost({ cid: 'first-page' })]
        const secondPosts = [makeFeedPost({ cid: 'second-page' })]

        searchPostsSpy
            .mockResolvedValueOnce({
                data: {
                    posts: firstPosts,
                    cursor: 'page-2'
                }
            })
            .mockResolvedValueOnce({
                data: {
                    posts: secondPosts,
                    cursor: 'page-3'
                }
            })
            .mockResolvedValueOnce({
                data: {
                    posts: firstPosts,
                    cursor: 'page-2'
                }
            })

        const state = stateMod.State()
        state.agent.value = makeAgent(searchPostsSpy)
        await stateMod.State.fetchFeed(state)
        await stateMod.State.fetchFeed(state, 'next')
        await stateMod.State.fetchFeed(state, 'prev')

        expect(searchPostsSpy).toHaveBeenCalledTimes(3)
        expect(searchPostsSpy.mock.calls[2][0]).toEqual({
            q: '#drering',
            sort: 'latest',
            limit: 20
        })
        expect(state.feedReq.value.data).toEqual(firstPosts)
        expect(state.feedPageIndex.value).toBe(0)
        expect(state.feedCursor.value).toBe('page-2')
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

    it('shows missing scope error without triggering reauth redirect',
        async () => {
            searchPostsSpy.mockRejectedValue(
                new Error(
                    'Missing required scope ' +
                '"rpc:app.bsky.feed.searchPosts?' +
                'aud=did:web:api.bsky.app"'
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
