import { h } from 'preact'
import {
    act,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { State, type AppState } from '../src/state'
import { Nav } from '../src/index'

describe('US-022 balance indicator in app header', () => {
    it('shows the authenticated stamp balance as a stamps link', async () => {
        const state = signedInState(5)
        const { container } = renderNav(state)

        const link = await screen.findByRole('link', { name: '5 stamps' })

        expect(link.getAttribute('href')).toBe('/settings/stamps')
        expect(within(link).getByText('5 stamps')).toBeTruthy()
        expect(link.querySelector('.icon-stamp')).toBeTruthy()
        expect(container.querySelector('.stamp-balance-link')).toBe(link)
    })

    it('omits the stamp balance for anonymous viewers', () => {
        const state = State()

        state.auth.value = {
            registered: false,
            authenticated: false
        }

        renderNav(state)

        expect(screen.queryByRole('link', { name: /stamps/i })).toBeNull()
    })

    it('reacts when the current balance changes', async () => {
        const state = signedInState(2)

        renderNav(state)

        expect(await screen.findByRole('link', { name: '2 stamps' }))
            .toBeTruthy()

        act(() => {
            state.currentUser.value = {
                ...state.currentUser.value!,
                stamps_balance: 8
            }
        })

        await waitFor(() => {
            expect(screen.getByRole('link', { name: '8 stamps' }))
                .toBeTruthy()
        })
    })

    it('is visible on authenticated routes outside settings', async () => {
        const state = signedInState(4)

        state.route.value = '/drawings'
        renderNav(state)

        expect(await screen.findByRole('link', { name: '4 stamps' }))
            .toBeTruthy()
    })
})

function renderNav (state:AppState):ReturnType<typeof render> {
    function NavWrapper () {
        return h(Nav, {
            route: state.route.value,
            isAuthed: state.isAuthed.value,
            authLoading: state.authLoading.value,
            stampsBalance: state.currentUser.value?.stamps_balance
        })
    }

    return render(h(NavWrapper, null))
}

function signedInState (stampsBalance:number):AppState {
    const state = State()

    state.auth.value = {
        registered: false,
        authenticated: true
    }
    state.currentUser.value = {
        id: 'user-1',
        email: 'stamps@example.com',
        subscription_status: 'free',
        stamps_balance: stampsBalance
    }

    return state
}
