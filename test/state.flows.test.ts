import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    const mockSetAgentFromOAuthSession = vi.fn(async (state:any, session:any) => {
        state.agent.value = { did: session.did } as any
        state.profile.value = {
            did: session.did,
            handle: 'alice.bsky.app',
            avatar: 'https://example.com/avatar.png'
        }
    })
    const mockOauthRedirectUri = vi.fn(() => 'http://127.0.0.1:8888/login')

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

let stateMod:any

describe('state oauth flows', () => {
    beforeEach(async () => {
        stateMod = await import('../src/state')
        vi.clearAllMocks()
        mockClient.initRestore.mockResolvedValue(undefined)
        mockClient.signInRedirect.mockResolvedValue(undefined)
        mockClient.initCallback.mockResolvedValue({
            session: { did: 'did:plc:callback-user' }
        })
        mockClient.restore.mockResolvedValue({
            did: 'did:plc:restored-user'
        })
        mockClient.revoke.mockResolvedValue(undefined)
    })

    it('fetchAuthStatus marks state unauthenticated when no session is restored', async () => {
        const state = stateMod.State()
        state.profile.value = {
            did: 'did:plc:old',
            handle: 'old.bsky.app',
            avatar: 'old-avatar'
        }
        state.agent.value = { did: 'did:plc:old' } as any

        const auth = await stateMod.State.fetchAuthStatus(state)

        expect(auth).toEqual({ registered: false, authenticated: false })
        expect(state.profile.value).toBeNull()
        expect(state.agent.value).toBeNull()
        expect(mockClient.initRestore).toHaveBeenCalledTimes(1)
    })

    it('fetchAuthStatus restores authenticated state and agent', async () => {
        const state = stateMod.State()
        const session = { did: 'did:plc:alice' }
        mockClient.initRestore.mockResolvedValue({ session })

        const auth = await stateMod.State.fetchAuthStatus(state)

        expect(auth).toEqual({ registered: true, authenticated: true })
        expect(mockSetAgentFromOAuthSession).toHaveBeenCalledWith(state, session)
        expect(state.profile.value?.did).toBe('did:plc:alice')
    })

    it('login trims handle and starts official oauth redirect', async () => {
        const state = stateMod.State()

        await stateMod.State.login(state, '  alice.bsky.app ')

        expect(mockClient.signInRedirect).toHaveBeenCalledWith(
            'alice.bsky.app',
            {
                scope: 'atproto transition:generic',
                redirect_uri: 'http://127.0.0.1:8888/login'
            }
        )
    })

    it('login rejects empty handle before oauth call', async () => {
        await expect(stateMod.State.login(stateMod.State(), '   ')).rejects.toThrow(
            'Bluesky handle is required'
        )
        expect(mockClient.signInRedirect).not.toHaveBeenCalled()
    })

    it('requestFeedScope redirects with full scope for current profile', async () => {
        const state = stateMod.State()
        state.profile.value = {
            did: 'did:plc:alice',
            handle: 'alice.bsky.app',
            avatar: ''
        }

        await stateMod.State.requestFeedScope(state)

        expect(mockClient.signInRedirect).toHaveBeenCalledWith(
            'alice.bsky.app',
            {
                scope: 'atproto transition:generic',
                redirect_uri: 'http://127.0.0.1:8888/login'
            }
        )
    })

    it('requestFeedScope rejects when no account can be determined', async () => {
        const state = stateMod.State()

        await expect(stateMod.State.requestFeedScope(state)).rejects.toThrow(
            'Could not determine account for scope upgrade. Please log out and sign in again.'
        )
        expect(mockClient.signInRedirect).not.toHaveBeenCalled()
    })

    it('finishOAuth processes callback query, hydrates agent, and updates auth', async () => {
        const state = stateMod.State()
        const callbackSession = { did: 'did:plc:callback-user' }
        mockClient.initCallback.mockResolvedValue({ session: callbackSession })

        await stateMod.State.finishOAuth(state, '?state=s123&code=c456')

        const [params, redirectUri] = mockClient.initCallback.mock.calls[0]
        expect(params).toBeInstanceOf(URLSearchParams)
        expect(params.get('state')).toBe('s123')
        expect(params.get('code')).toBe('c456')
        expect(redirectUri).toBe('http://127.0.0.1:8888/login')
        expect(mockSetAgentFromOAuthSession).toHaveBeenCalledWith(
            state,
            callbackSession
        )
        expect(state.auth.value).toEqual({ registered: true, authenticated: true })
    })

    it('createAgent restores oauth session by did and hydrates agent', async () => {
        const state = stateMod.State()
        const session = { did: 'did:plc:create-agent' }
        mockClient.restore.mockResolvedValue(session)

        await stateMod.State.createAgent(state, 'did:plc:create-agent')

        expect(mockClient.restore).toHaveBeenCalledWith('did:plc:create-agent')
        expect(mockSetAgentFromOAuthSession).toHaveBeenCalledWith(state, session)
    })

    it('hydrateAgent returns null when no session is available', async () => {
        const state = stateMod.State()
        mockClient.initRestore.mockResolvedValue(undefined)

        const agent = await stateMod.State.hydrateAgent(state)

        expect(agent).toBeNull()
        expect(mockSetAgentFromOAuthSession).not.toHaveBeenCalled()
    })

    it('hydrateAgent restores session and marks authenticated', async () => {
        const state = stateMod.State()
        const session = { did: 'did:plc:hydrate-user' }
        mockClient.initRestore.mockResolvedValue({ session })

        const agent = await stateMod.State.hydrateAgent(state)

        expect(agent).not.toBeNull()
        expect(mockSetAgentFromOAuthSession).toHaveBeenCalledWith(state, session)
        expect(state.auth.value).toEqual({ registered: true, authenticated: true })
    })

    it('post publishes with current agent and records request success state', async () => {
        const state = stateMod.State()
        const postSpy = vi.fn(async () => ({
            uri: 'at://did:plc:alice/app.bsky.feed.post/123',
            cid: 'bafy-post-cid'
        }))
        state.agent.value = { post: postSpy } as any
        state.profile.value = {
            did: 'did:plc:alice',
            handle: 'alice.bsky.app',
            avatar: ''
        }

        const res = await stateMod.State.post(state)

        expect(postSpy).toHaveBeenCalledTimes(1)
        expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({
            text: 'New drering from @alice.bsky.app',
            tags: ['drering']
        }))
        expect(typeof postSpy.mock.calls[0][0].createdAt).toBe('string')
        expect(res).toEqual({
            uri: 'at://did:plc:alice/app.bsky.feed.post/123',
            cid: 'bafy-post-cid'
        })
        expect(state.postReq.value).toEqual({
            pending: false,
            data: {
                uri: 'at://did:plc:alice/app.bsky.feed.post/123',
                cid: 'bafy-post-cid'
            },
            error: null
        })
    })

    it('post uploads image blob and includes images embed', async () => {
        const state = stateMod.State()
        const uploadBlobSpy = vi.fn(async () => ({
            data: {
                blob: {
                    $type: 'blob',
                    ref: { $link: 'bafk-image-ref' },
                    mimeType: 'image/png',
                    size: 1234
                }
            }
        }))
        const postSpy = vi.fn(async () => ({
            uri: 'at://did:plc:alice/app.bsky.feed.post/456',
            cid: 'bafy-post-cid-2'
        }))
        state.agent.value = {
            post: postSpy,
            uploadBlob: uploadBlobSpy
        } as any
        state.profile.value = {
            did: 'did:plc:alice',
            handle: 'alice.bsky.app',
            avatar: ''
        }
        const imageBlob = new Blob(['png-binary'], { type: 'image/png' })

        await stateMod.State.post(state, 'caption text', imageBlob)

        expect(uploadBlobSpy).toHaveBeenCalledTimes(1)
        expect(uploadBlobSpy.mock.calls[0][1]).toEqual({ encoding: 'image/png' })
        expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({
            text: 'caption text',
            tags: ['drering'],
            embed: {
                $type: 'app.bsky.embed.images',
                images: [{
                    alt: 'caption text',
                    image: expect.any(Object)
                }]
            }
        }))
    })

    it('post fails and stores request error when no session can be restored', async () => {
        const state = stateMod.State()
        const hydrateSpy = vi.spyOn(stateMod.State, 'hydrateAgent')
            .mockResolvedValue(null)

        await expect(stateMod.State.post(state)).rejects.toThrow(
            'You need to log in before posting.'
        )
        expect(hydrateSpy).toHaveBeenCalledWith(state)
        expect(state.postReq.value.pending).toBe(false)
        expect(state.postReq.value.error?.message).toBe(
            'You need to log in before posting.'
        )
    })

    it('logout revokes current did session and clears in-memory auth state', async () => {
        const state = stateMod.State()
        state.profile.value = {
            did: 'did:plc:logout-user',
            handle: 'logout.bsky.app',
            avatar: ''
        }
        state.auth.value = { registered: true, authenticated: true }
        state.agent.value = { did: 'did:plc:logout-user' } as any
        state.postReq.value = {
            pending: false,
            data: {
                uri: 'at://did:plc:logout-user/app.bsky.feed.post/old',
                cid: 'old-cid'
            },
            error: null
        }

        await stateMod.State.Logout(state)

        expect(mockClient.revoke).toHaveBeenCalledWith('did:plc:logout-user')
        expect(state.auth.value).toEqual({ registered: false, authenticated: false })
        expect(state.profile.value).toBeNull()
        expect(state.agent.value).toBeNull()
        expect(state.postReq.value.data).toBeNull()
    })

    it('logout falls back to restored session signOut when did is missing', async () => {
        const state = stateMod.State()
        const signOut = vi.fn(async () => {})
        mockClient.initRestore.mockResolvedValue({
            session: { signOut }
        })

        await stateMod.State.Logout(state)

        expect(mockClient.revoke).not.toHaveBeenCalled()
        expect(mockClient.initRestore).toHaveBeenCalledWith(false)
        expect(signOut).toHaveBeenCalledTimes(1)
    })
})
