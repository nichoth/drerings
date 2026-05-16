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

describe('US-007 buy-pack modal UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows the three stamp packs and closes cleanly', async () => {
        const state = signedInState()
        const Route = routeFor('/pricing', state)

        render(h(Route, { state }))

        await fireEvent.click(screen.getByRole('button', {
            name: 'Buy stamps'
        }))

        const dialog = screen.getByRole('dialog', { name: 'Buy stamps' })

        expect(within(dialog).getByRole('heading', {
            name: 'Starter'
        })).toBeTruthy()
        expect(within(dialog).getByText('10 stamps')).toBeTruthy()
        expect(within(dialog).getByText('$5.00')).toBeTruthy()
        expect(within(dialog).getByText('50c each')).toBeTruthy()

        const bundle = within(dialog).getByRole('article', {
            name: 'Bundle'
        })

        expect(within(bundle).getByText('Recommended')).toBeTruthy()
        expect(within(bundle).getByText('25 stamps')).toBeTruthy()
        expect(within(bundle).getByText('$10.00')).toBeTruthy()
        expect(within(bundle).getByText('40c each')).toBeTruthy()

        expect(within(dialog).getByRole('heading', {
            name: 'Big bundle'
        })).toBeTruthy()
        expect(within(dialog).getByText('60 stamps')).toBeTruthy()
        expect(within(dialog).getByText('$20.00')).toBeTruthy()
        expect(within(dialog).getByText('33.33c each')).toBeTruthy()

        await fireEvent.click(within(dialog).getByRole('button', {
            name: 'Close'
        }))

        expect(screen.queryByRole('dialog', { name: 'Buy stamps' }))
            .toBeNull()
    })

    it('starts checkout for the selected stamp pack', async () => {
        const state = signedInState()
        const assign = vi.fn()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                url: 'https://checkout.stripe.com/pay/stamps_bundle'
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
            name: 'Buy stamps'
        }))
        await fireEvent.click(screen.getByRole('button', {
            name: 'Buy Bundle'
        }))

        await waitFor(() => {
            expect(fetcher).toHaveBeenCalledWith('/api/billing/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'buyer@example.com',
                    product_id: 'stamps_bundle'
                })
            })
            expect(assign).toHaveBeenCalledWith(
                'https://checkout.stripe.com/pay/stamps_bundle'
            )
        })
    })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'buyer@example.com',
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
