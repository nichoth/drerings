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

    it('canShare only allows active paid users', () => {
        const state = State()

        expect(state.canShare.value).toBe(false)

        state.currentUser.value = {
            id: 'user-free',
            email: 'free@example.com',
            subscription_status: 'free'
        }
        expect(state.canShare.value).toBe(false)

        state.currentUser.value = {
            id: 'user-active',
            email: 'active@example.com',
            subscription_status: 'active'
        }
        expect(state.canShare.value).toBe(true)

        state.currentUser.value = {
            id: 'user-canceled',
            email: 'canceled@example.com',
            subscription_status: 'canceled'
        }
        expect(state.canShare.value).toBe(false)

        state.currentUser.value = {
            id: 'user-past-due',
            email: 'past-due@example.com',
            subscription_status: 'past_due'
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
            email: 'user@example.com',
            subscription_status: 'active'
        }
        state.profile.value = {
            id: 'user-1',
            email: 'user@example.com'
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
                email: 'user@example.com',
                subscription_status: 'active'
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
            email: 'user@example.com',
            subscription_status: 'active'
        })
        expect(state.profile.value).toEqual({
            id: 'user-1',
            email: 'user@example.com'
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
            email: 'user@example.com',
            subscription_status: 'active'
        }
        state.profile.value = {
            id: 'user-1',
            email: 'user@example.com'
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
