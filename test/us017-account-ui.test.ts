import { h, type FunctionComponent } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { State, type AppState } from '../src/state'
import Router from '../src/routes/index'

vi.mock('@simplewebauthn/browser', () => {
    return {
        browserSupportsWebAuthn: () => true,
        startRegistration: async () => ({ id: 'credential-1' })
    }
})

describe('US-017 account UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows email, subscription, passkeys, and account actions',
        async () => {
            const state = signedInState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(accountBody())
            }))

            const Route = routeFor('/account', state)

            render(h(Route, { state }))

            expect(await screen.findByText('paid@example.com')).toBeTruthy()
            expect(await screen.findByText('Active - renews 2026-06-01'))
                .toBeTruthy()

            const passkeys = screen.getByRole('region', {
                name: 'Passkeys'
            })

            expect(within(passkeys).getByText(/added may 1, 2026/i))
                .toBeTruthy()
            expect(within(passkeys).getByRole('button', {
                name: /register new passkey/i
            })).toBeTruthy()
            expect(within(passkeys).getByRole('button', {
                name: /remove/i
            })).toBeTruthy()
            expect(screen.getByRole('button', {
                name: /cancel subscription/i
            })).toBeTruthy()
            expect(screen.getByRole('button', {
                name: /delete account/i
            })).toBeTruthy()
        })

    it('requests an email update confirmation link', async () => {
        const state = signedInState()
        const fetcher = vi.fn(async (url:string) => {
            if (url === '/api/account') return jsonResponse(accountBody())

            return jsonResponse({ ok: true })
        })

        vi.stubGlobal('fetch', fetcher)

        const Route = routeFor('/account', state)

        render(h(Route, { state }))

        await screen.findByText('paid@example.com')
        await fireEvent.input(screen.getByLabelText('New email'), {
            target: { value: 'new@example.com' }
        })
        await fireEvent.click(screen.getByRole('button', {
            name: /update email/i
        }))

        await waitFor(() => {
            expect(fetcher).toHaveBeenCalledWith('/api/account/email', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ email: 'new@example.com' })
            })
        })
        expect(await screen.findByText(/check new@example.com/i)).toBeTruthy()
    })

    it('cancels subscription and updates the displayed status', async () => {
        const state = signedInState()
        const fetcher = vi.fn(async (url:string) => {
            if (url === '/api/billing/cancel') {
                return jsonResponse({
                    subscription_status: 'canceled',
                    subscription_current_period_end: '2026-06-01'
                })
            }

            return jsonResponse(accountBody())
        })

        vi.stubGlobal('fetch', fetcher)

        const Route = routeFor('/account', state)

        render(h(Route, { state }))

        await screen.findByText('Active - renews 2026-06-01')
        await fireEvent.click(screen.getByRole('button', {
            name: /cancel subscription/i
        }))

        expect(await screen.findByText('Canceled - ends 2026-06-01'))
            .toBeTruthy()
    })

    it('requires DELETE confirmation before deleting the account',
        async () => {
            const state = signedInState()
            const fetcher = vi.fn(async (url:string) => {
                if (url === '/api/account') return jsonResponse(accountBody())

                return jsonResponse({ deleted: true })
            })

            vi.stubGlobal('fetch', fetcher)

            const Route = routeFor('/account', state)

            render(h(Route, { state }))

            await screen.findByText('paid@example.com')
            await fireEvent.click(screen.getByRole('button', {
                name: /delete account/i
            }))

            expect(screen.getByText('Type DELETE to confirm')).toBeTruthy()

            await fireEvent.input(screen.getByLabelText('Confirmation'), {
                target: { value: 'DELETE' }
            })
            await fireEvent.click(screen.getByRole('button', {
                name: 'Confirm delete'
            }))

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith('/api/account', {
                    method: 'DELETE'
                })
            })
            expect(state.currentUser.value).toBe(null)
        })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active'
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
}

function accountBody () {
    return {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active',
        subscription_current_period_end: '2026-06-01',
        passkeys: [{
            id: 'passkey-1',
            created_at: '2026-05-01T00:00:00.000Z'
        }]
    }
}

function jsonResponse (body:Record<string, unknown>):Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    })
}

function routeFor (
    path:string,
    state:AppState
):FunctionComponent<{ state:AppState }> {
    const router = Router(state)
    const match = router.match(path)
    const Route = match?.action?.(match, path)

    expect(Route).toBeTruthy()

    return Route as FunctionComponent<{ state:AppState }>
}
