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

describe('US-028 nav settings link visibility', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('omits Settings while auth is loading', async () => {
        const state = makeState({ authLoading: true, isAuthed: false })
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /settings/i })
        ).toBeNull()
        expect(
            screen.queryByRole('link', { name: /home/i })
        ).toBeTruthy()
        expect(
            screen.queryByRole('link', { name: /drawings/i })
        ).toBeTruthy()
    })

    it('omits Settings for an anonymous viewer', async () => {
        stubWhoami({ authenticated: false })
        const state = State()
        await State.fetchAuthStatus(state)
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /settings/i })
        ).toBeNull()
    })

    it(
        'does not visually hide Settings — it is absent from the DOM',
        async () => {
            const state = makeState({
                authLoading: false,
                isAuthed: false
            })
            mountApp(state)
            expect(
                document.querySelector('a[href="/settings"]')
            ).toBeNull()
            expect(
                document.querySelector(
                    '[aria-hidden="true"] a[href="/settings"]'
                )
            ).toBeNull()
            expect(
                document.querySelector(
                    '[hidden] a[href="/settings"]'
                )
            ).toBeNull()
        }
    )

    it('shows Settings for an authenticated viewer', async () => {
        const state = makeState({ authLoading: false, isAuthed: true })
        mountApp(state)
        const link = await screen.findByRole('link', { name: /settings/i })
        expect(link).toBeTruthy()
        expect(link.getAttribute('href')).toBe('/settings')
    })

    it('renders the Settings link in its canonical position', async () => {
        const state = makeState({ authLoading: false, isAuthed: true })
        const { container } = mountApp(state)
        const nav = container.querySelector(
            'nav[aria-label="Main navigation"]'
        )!
        const links = within(nav as HTMLElement).getAllByRole('link')
        const last = links[links.length - 1]
        expect(last.getAttribute('href')).toBe('/settings')
    })

    it('reveals Settings on sign-in without reload', async () => {
        const state = makeState({ authLoading: false, isAuthed: false })
        mountApp(state)
        expect(
            screen.queryByRole('link', { name: /settings/i })
        ).toBeNull()
        act(() => {
            state.auth.value = { authenticated: true, registered: true }
        })
        expect(
            await screen.findByRole('link', { name: /settings/i })
        ).toBeTruthy()
    })

    it('hides Settings on sign-out without reload', async () => {
        const state = makeState({ authLoading: false, isAuthed: true })
        mountApp(state)
        expect(
            await screen.findByRole('link', { name: /settings/i })
        ).toBeTruthy()
        act(() => {
            state.auth.value = {
                authenticated: false,
                registered: false
            }
        })
        await waitFor(() => {
            expect(
                screen.queryByRole('link', { name: /settings/i })
            ).toBeNull()
        })
    })
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

function stubWhoami ({ authenticated }:{ authenticated:boolean }):void {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ authenticated })
    })))
}
