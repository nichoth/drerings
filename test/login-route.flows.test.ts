import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LoginRoute } from '../src/routes/login'
import { State, type AppState } from '../src/state'

vi.mock('@substrate-system/input', () => ({
    SubstrateInput: { TAG: 'input' }
}))

function createLoginState ():AppState {
    const state = State()
    state.route.value = '/login'
    return state
}

describe('login route flows', () => {
    beforeEach(() => {
        history.replaceState(null, '', '/login')
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('shows authenticated message when already logged in', () => {
        const state = createLoginState()
        state.auth.value = { registered: true, authenticated: true }

        render(h(LoginRoute, { state }))

        expect(screen.getByText(/already logged in/i)).toBeTruthy()
        expect(screen.queryByText('Continue with Bluesky')).toBeNull()
    })

    it('submits valid handle and starts oauth login', async () => {
        const state = createLoginState()
        const loginSpy = vi.spyOn(State, 'login').mockResolvedValue(undefined)

        const view = render(h(LoginRoute, { state }))
        const handleField = view.container.querySelector('#bsky-handle') as
            (HTMLElement & { value:string })
        const form = view.container.querySelector('form') as HTMLFormElement

        handleField.value = '  alice.bsky.app  '
        fireEvent.input(handleField)
        fireEvent.submit(form)

        await waitFor(() => {
            expect(loginSpy).toHaveBeenCalledWith(state, 'alice.bsky.app')
        })
    })

    it('shows validation error for empty handle submit', async () => {
        const state = createLoginState()
        const view = render(h(LoginRoute, { state }))
        const form = view.container.querySelector('form') as HTMLFormElement

        fireEvent.submit(form)

        await waitFor(() => {
            expect(screen.getByText('Enter your Bluesky handle')).toBeTruthy()
        })
    })

    it('completes oauth callback and routes to home', async () => {
        vi.useFakeTimers()
        history.replaceState(null, '', '/login?state=abc&code=123')

        const state = createLoginState()
        const setRouteSpy = vi.fn()
        state._setRoute = setRouteSpy

        const finishSpy = vi.spyOn(State, 'finishOAuth')
            .mockResolvedValue(undefined)
        const clearSpy = vi.spyOn(State, 'clearOAuthQuery')
            .mockImplementation(() => {})

        render(h(LoginRoute, { state }))

        await waitFor(() => {
            expect(finishSpy).toHaveBeenCalledTimes(1)
        })

        const queryArg = finishSpy.mock.calls[0][1] as URLSearchParams
        expect(queryArg.get('state')).toBe('abc')
        expect(queryArg.get('code')).toBe('123')
        expect(clearSpy).toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(400)
        expect(setRouteSpy).toHaveBeenCalledWith('/')
    })

    it('renders oauth callback errors without calling finish', async () => {
        history.replaceState(
            null,
            '',
            '/login?state=abc&error=access_denied&' +
                'error_description=Denied+by+user'
        )

        const state = createLoginState()
        const finishSpy = vi.spyOn(State, 'finishOAuth')
            .mockResolvedValue(undefined)
        const clearSpy = vi.spyOn(State, 'clearOAuthQuery')
            .mockImplementation(() => {})

        render(h(LoginRoute, { state }))

        await waitFor(() => {
            expect(screen.getByText('Denied by user')).toBeTruthy()
        })

        expect(finishSpy).not.toHaveBeenCalled()
        expect(clearSpy).toHaveBeenCalledTimes(1)
    })
})
