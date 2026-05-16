import { h, type FunctionComponent } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    render,
    screen,
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

describe('US-018 pending gifts UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows pending gifts on the sender stamps panel', async () => {
        const state = signedInState()
        const fetcher = vi.fn(async (url:string) => {
            if (url === '/api/stamps/lots') {
                return jsonResponse({
                    lots: [],
                    pending_gifts: [{
                        id: 'pending-gift-1',
                        recipient_email: 'new-friend@example.com',
                        pack_id: 'stamps_bundle',
                        count: 25,
                        price_cents: 1000,
                        status: 'pending',
                        created_at: '2026-05-15T00:00:00.000Z'
                    }]
                })
            }

            throw new Error(`Unexpected fetch: ${url}`)
        })

        vi.stubGlobal('fetch', fetcher)

        const Route = routeFor('/settings', state)

        render(h(Route, { state }))

        const stamps = await screen.findByRole('region', {
            name: 'Stamp lots'
        })

        expect(await within(stamps).findByText('Pending gifts')).toBeTruthy()
        expect(within(stamps).getByText('new-friend@example.com')).toBeTruthy()
        expect(within(stamps).getByText('25 stamps')).toBeTruthy()
        expect(within(stamps).getByText('$10.00')).toBeTruthy()
        expect(within(stamps).getByText('Pending')).toBeTruthy()
    })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'sender-1',
        email: 'sender@example.com',
        subscription_status: 'active',
        stamps_balance: 12
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
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
