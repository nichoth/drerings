import { describe, expect, it } from 'vitest'
import { State } from '../src/state'

describe('state auth baseline', () => {
    it('starts unauthenticated', () => {
        const state = State()

        expect(state.auth.value).toEqual({
            registered: false,
            authenticated: false
        })
        expect(state.profile.value).toBeNull()
        expect(state.isAuthed.value).toBe(false)
    })

    it('fetchAuthStatus keeps state unauthenticated', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }
        state.profile.value = {
            id: 'user-1',
            email: 'user@example.com'
        }

        const auth = await State.fetchAuthStatus(state)

        expect(auth).toEqual({
            registered: false,
            authenticated: false
        })
        expect(state.profile.value).toBeNull()
        expect(state.isAuthed.value).toBe(false)
    })

    it('logout clears local auth state', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
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
        expect(state.profile.value).toBeNull()
    })
})
