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

describe('US-014 checkout UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('starts checkout from the signed-in pricing CTA', async () => {
        const state = signedInState()
        const assign = vi.fn()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                url: 'https://checkout.stripe.com/pay/cs_test_123'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        vi.stubGlobal('fetch', fetcher)
        vi.stubGlobal('location', {
            ...window.location,
            assign
        })

        const Route = routeFor('/pricing', state)

        render(h(Route, { state }))

        await fireEvent.click(screen.getByRole('button', {
            name: 'Subscribe - $5/month'
        }))

        await waitFor(() => {
            expect(fetcher).toHaveBeenCalledWith('/api/billing/checkout', {
                method: 'POST'
            })
            expect(assign).toHaveBeenCalledWith(
                'https://checkout.stripe.com/pay/cs_test_123'
            )
        })
    })

    it('shows checkout errors inline', async () => {
        const state = signedInState()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                error: 'Checkout is not configured.'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        vi.stubGlobal('fetch', fetcher)

        const Route = routeFor('/pricing', state)

        render(h(Route, { state }))

        await fireEvent.click(screen.getByRole('button', {
            name: 'Subscribe - $5/month'
        }))

        const alert = await screen.findByRole('alert')

        expect(alert.textContent).toMatch(/checkout is not configured/i)
    })

    it('routes Autumn returns to the account page', () => {
        const state = signedInState()
        history.pushState(null, '', '/account?status=ok')
        const Route = routeFor('/account', state)

        render(h(Route, { state }))

        expect(screen.getByRole('heading', {
            name: 'Account'
        })).toBeTruthy()
        expect(screen.getByText(/subscription is being activated/i))
            .toBeTruthy()
    })

    it('shows a cancellation message on account return', () => {
        const state = signedInState()
        history.pushState(null, '', '/account?status=cancel')
        const Route = routeFor('/account', state)

        render(h(Route, { state }))

        const account = screen.getByRole('region', {
            name: 'Subscription'
        })

        expect(within(account).getByText(/checkout was canceled/i))
            .toBeTruthy()
    })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'free@example.com',
        subscription_status: 'free'
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
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
