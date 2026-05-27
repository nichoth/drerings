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

describe('US-016 stamp refund UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows refundable lots and confirms a refund before posting',
        async () => {
            const state = signedInState()
            const fetcher = vi.fn(async (
                url:string,
                options?:RequestInit
            ) => {
                if (url === '/api/stamps-lots') {
                    return jsonResponse({
                        lots: stampLots()
                    })
                }

                if (url === '/api/stamps-refund/lot-purchase') {
                    expect(options?.method).toBe('POST')

                    return jsonResponse({
                        refund_cents: 600,
                        stamps_balance: 10
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

            expect(await within(stamps).findByText(
                '15 of 25 stamps left'
            ))
                .toBeTruthy()
            expect(within(stamps).getByText('$6.00 refund')).toBeTruthy()
            expect(within(stamps).getByText('10 of 10 stamps left'))
                .toBeTruthy()
            expect(within(stamps).getAllByText('Gift from another user'))
                .toBeTruthy()

            const purchaseLot = within(stamps).getByRole('listitem', {
                name: /may 1, 2026/i
            })

            await fireEvent.click(within(purchaseLot).getByRole('button', {
                name: /refund unused stamps/i
            }))

            expect(within(purchaseLot).getByText(
                'Refund $6.00 to your card?'
            )).toBeTruthy()

            await fireEvent.click(within(purchaseLot).getByRole('button', {
                name: 'Confirm refund'
            }))

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith(
                    '/api/stamps-refund/lot-purchase',
                    { method: 'POST' }
                )
            })

            expect(await screen.findByText(
                'Refunded $6.00. Your balance is 10 stamps.'
            )).toBeTruthy()
            expect(state.currentUser.value?.stamps_balance).toBe(10)
        })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        did: 'did:plc:test-1',
        handle: 'paid.bsky.social',
        stamps_balance: 25
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
}

function stampLots () {
    return [
        {
            id: 'lot-purchase',
            source: 'purchase',
            original_count: 25,
            remaining_count: 15,
            refund_cents: 600,
            created_at: '2026-05-01T00:00:00.000Z'
        },
        {
            id: 'lot-grant',
            source: 'grant',
            original_count: 10,
            remaining_count: 10,
            refund_cents: 0,
            created_at: '2026-05-02T00:00:00.000Z'
        },
        {
            id: 'lot-gift',
            source: 'gift_received',
            original_count: 25,
            remaining_count: 25,
            refund_cents: 0,
            created_at: '2026-05-03T00:00:00.000Z'
        }
    ]
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
