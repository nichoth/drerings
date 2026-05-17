import { h } from 'preact'
import {
    act,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { describe, it, afterEach, vi } from 'vitest'
import { State, type AppState } from '../src/state'
import { Nav } from '../src/index'

describe('US-029 nav account link visibility', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('omits Account while auth is loading', async () => {
        const state = makeState({ authLoading: true, isAuthed: false })
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /account/i })
        ).toBeNull()
        expect(
            screen.queryByRole('link', { name: /home/i })
        ).toBeTruthy()
        expect(
            screen.queryByRole('link', { name: /drawings/i })
        ).toBeTruthy()
    })

    it('omits Account for an anonymous viewer', async () => {
        const state = makeState({ authLoading: false, isAuthed: false })
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /account/i })
        ).toBeNull()
        expect(
            document.querySelector('a[href="/account"]')
        ).toBeNull()
        expect(
            document.querySelector(
                '[aria-hidden="true"] a[href="/account"]'
            )
        ).toBeNull()
        expect(
            document.querySelector(
                '[hidden] a[href="/account"]'
            )
        ).toBeNull()
    })

    it('shows Account for an authenticated viewer', async () => {
        const state = makeState({ authLoading: false, isAuthed: true })
        mountApp(state)
        const link = await screen.findByRole('link', { name: /account/i })
        expect(link).toBeTruthy()
        expect(link.getAttribute('href')).toBe('/account')
    })

    it(
        'renders the Account link in its canonical position ' +
        '(after /pricing, before /colophon)',
        async () => {
            const state = makeState({ authLoading: false, isAuthed: true })
            const { container } = mountApp(state)
            const nav = container.querySelector(
                'nav[aria-label="Main navigation"]'
            )!
            const links = within(nav as HTMLElement).getAllByRole('link')
            const hrefs = links.map(l => l.getAttribute('href'))
            const accountIdx = hrefs.indexOf('/account')
            const pricingIdx = hrefs.indexOf('/pricing')
            const colophonIdx = hrefs.indexOf('/colophon')
            expect(accountIdx).toBeGreaterThan(-1)
            expect(accountIdx).toBe(pricingIdx + 1)
            expect(colophonIdx).toBe(accountIdx + 1)
        }
    )

    it(
        'renders Account and Settings together (C-005 symmetry)',
        async () => {
            const authedState = makeState({
                authLoading: false,
                isAuthed: true
            })
            const authed = mountApp(authedState)
            expect(
                screen.queryByRole('link', { name: /account/i })
            ).not.toBeNull()
            expect(
                screen.queryByRole('link', { name: /settings/i })
            ).not.toBeNull()
            authed.unmount()

            const anonState = makeState({
                authLoading: false,
                isAuthed: false
            })
            mountApp(anonState)
            expect(
                screen.queryByRole('link', { name: /account/i })
            ).toBeNull()
            expect(
                screen.queryByRole('link', { name: /settings/i })
            ).toBeNull()
        }
    )

    it('reveals Account on sign-in without reload', async () => {
        const state = makeState({ authLoading: false, isAuthed: false })
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /account/i })
        ).toBeNull()
        act(() => {
            state.auth.value = { authenticated: true, registered: true }
        })
        expect(
            await screen.findByRole('link', { name: /account/i })
        ).toBeTruthy()
    })

    it('hides Account on sign-out without reload', async () => {
        const state = makeState({ authLoading: false, isAuthed: true })
        mountApp(state)
        expect(
            await screen.findByRole('link', { name: /account/i })
        ).toBeTruthy()
        act(() => {
            state.auth.value = {
                authenticated: false,
                registered: false
            }
        })
        await waitFor(() => {
            expect(
                screen.queryByRole('link', { name: /account/i })
            ).toBeNull()
        })
    })

    it(
        'does not flash Account when authLoading resolves anonymous',
        async () => {
            const state = makeState({
                authLoading: true,
                isAuthed: false
            })
            mountApp(state)
            expect(
                screen.queryByRole('link', { name: /account/i })
            ).toBeNull()
            act(() => {
                state.authLoading.value = false
            })
            expect(
                screen.queryByRole('link', { name: /account/i })
            ).toBeNull()
        }
    )
})

function mountApp (state:AppState):ReturnType<typeof render> {
    function NavWrapper () {
        return h(Nav, {
            route: state.route.value,
            isAuthed: !!state.auth.value?.authenticated,
            authLoading: state.authLoading.value
        })
    }
    return render(h(NavWrapper, null))
}

function makeState ({
    authLoading,
    isAuthed
}:{ authLoading:boolean; isAuthed:boolean }):AppState {
    const state = State()
    state.authLoading.value = authLoading
    state.auth.value = { authenticated: isAuthed, registered: false }
    return state
}

