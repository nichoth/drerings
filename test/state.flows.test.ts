import { afterEach, describe, expect, it, vi } from 'vitest'
import { State } from '../src/state'

describe('state auth baseline', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('starts unauthenticated', () => {
        const state = State()

        expect(state.auth.value).toEqual({
            registered: false,
            authenticated: false
        })
        expect(state.profile.value).toBeNull()
        expect(state.isAuthed.value).toBe(false)
    })

    it('canShare allows authenticated users', () => {
        const state = State()

        expect(state.canShare.value).toBe(false)

        state.auth.value = {
            registered: false,
            authenticated: true
        }
        state.currentUser.value = {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        }
        expect(state.canShare.value).toBe(true)

        state.auth.value = {
            registered: false,
            authenticated: false
        }
        expect(state.canShare.value).toBe(false)
    })

    it('fetchAuthStatus keeps state unauthenticated', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }
        state.currentUser.value = {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        }
        state.profile.value = {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        }
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({ error: 'Sign in' }), {
                status: 401,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)

        const auth = await State.fetchAuthStatus(state)

        expect(auth).toEqual({
            registered: false,
            authenticated: false
        })
        expect(state.currentUser.value).toBeNull()
        expect(state.profile.value).toBeNull()
        expect(state.isAuthed.value).toBe(false)
        expect(fetcher).toHaveBeenCalledWith('/api/whoami')
    })

    it('fetchAuthStatus populates the current user from whoami', async () => {
        const state = State()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                id: 'user-1',
                did: 'did:plc:test-1',
                handle: 'user.bsky.social'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)

        const auth = await State.fetchAuthStatus(state)

        expect(auth).toEqual({
            registered: false,
            authenticated: true
        })
        expect(state.currentUser.value).toEqual({
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        })
        expect(state.profile.value).toEqual({
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        })
        expect(state.isAuthed.value).toBe(true)
    })

    it('logout clears local auth state', async () => {
        const state = State()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                logged_out: true
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)
        state.auth.value = {
            registered: true,
            authenticated: true
        }
        state.currentUser.value = {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        }
        state.profile.value = {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'user.bsky.social'
        }

        await State.Logout(state)

        expect(state.auth.value).toEqual({
            registered: false,
            authenticated: false
        })
        expect(state.currentUser.value).toBeNull()
        expect(state.profile.value).toBeNull()
        expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', {
            method: 'POST'
        })
    })
})
