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

describe('US-023 stamps page', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('renders balance, purchase CTA, history, lots, and sent gifts',
        async () => {
            const state = signedInState()
            const fetcher = vi.fn(async (url:string) => {
                if (url === '/api/stamps-lots') {
                    return jsonResponse({
                        lots: stampLots(),
                        pending_gifts: [],
                        sent_gifts: sentGifts()
                    })
                }

                if (url === '/api/stamps-transactions') {
                    return jsonResponse({
                        transactions: stampTransactions(),
                        next_before: '2026-05-01T00:00:00.000Z'
                    })
                }

                throw new Error(`Unexpected fetch: ${url}`)
            })

            vi.stubGlobal('fetch', fetcher)

            const Route = routeFor('/settings/stamps', state)

            render(h(Route, { state }))

            expect(await screen.findByRole('heading', {
                name: 'Stamps'
            })).toBeTruthy()
            expect(screen.getByText('24 stamps available')).toBeTruthy()
            expect(screen.getByRole('button', {
                name: 'Buy more stamps'
            })).toBeTruthy()

            const history = await screen.findByRole('region', {
                name: 'Transaction history'
            })

            expect(within(history).getByText('Purchase')).toBeTruthy()
            expect(within(history).getByText('+25')).toBeTruthy()
            expect(within(history).getByText('Balance 25')).toBeTruthy()
            expect(within(history).getByText('Postcard sent')).toBeTruthy()
            expect(within(history).getByText('-1')).toBeTruthy()
            expect(within(history).getByRole('button', {
                name: 'Load more transactions'
            })).toBeTruthy()

            const lots = await screen.findByRole('region', {
                name: 'Stamp lots'
            })

            expect(within(lots).getByText('15 of 25 stamps left'))
                .toBeTruthy()
            expect(within(lots).getByText('friend.bsky.social'))
                .toBeTruthy()

            await fireEvent.click(screen.getByRole('button', {
                name: 'Buy more stamps'
            }))

            expect(screen.getByRole('dialog', { name: 'Buy stamps' }))
                .toBeTruthy()
        })

    it('links the settings overview to the dedicated stamps page', () => {
        const state = signedInState()
        const Route = routeFor('/settings', state)

        vi.stubGlobal('fetch', async (url:string) => {
            if (url === '/api/stamps-lots') {
                return jsonResponse({
                    lots: [],
                    pending_gifts: [],
                    sent_gifts: []
                })
            }

            throw new Error(`Unexpected fetch: ${url}`)
        })

        render(h(Route, { state }))

        expect(screen.getByRole('link', { name: 'Stamps' })
            .getAttribute('href')).toBe('/settings/stamps')
    })

    it('loads the next history page when a cursor is available',
        async () => {
            const state = signedInState()
            const fetcher = vi.fn(async (url:string) => {
                if (url === '/api/stamps-lots') {
                    return jsonResponse({
                        lots: [],
                        pending_gifts: [],
                        sent_gifts: []
                    })
                }

                if (url === '/api/stamps-transactions') {
                    return jsonResponse({
                        transactions: [stampTransactions()[0]],
                        next_before: '2026-05-03T00:00:00.000Z'
                    })
                }

                if (
                    url === '/api/stamps-transactions' +
                        '?before=2026-05-03T00%3A00%3A00.000Z'
                ) {
                    return jsonResponse({
                        transactions: [stampTransactions()[1]],
                        next_before: null
                    })
                }

                throw new Error(`Unexpected fetch: ${url}`)
            })

            vi.stubGlobal('fetch', fetcher)

            const Route = routeFor('/settings/stamps', state)

            render(h(Route, { state }))

            await screen.findByText('Purchase')
            await fireEvent.click(screen.getByRole('button', {
                name: 'Load more transactions'
            }))

            await waitFor(() => {
                expect(screen.getByText('Postcard sent')).toBeTruthy()
            })
            expect(fetcher).toHaveBeenCalledWith(
                '/api/stamps-transactions' +
                    '?before=2026-05-03T00%3A00%3A00.000Z'
            )
        })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        did: 'did:plc:test-1',
        handle: 'user.bsky.social',
        stamps_balance: 24
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
        }
    ]
}

function sentGifts () {
    return [
        {
            id: 'lot-unused',
            recipient_handle: 'friend.bsky.social',
            original_count: 25,
            remaining_count: 25,
            refund_cents: 1000,
            refundable: true,
            refundable_until: '2026-05-31T00:00:00.000Z',
            status: 'unused',
            created_at: '2026-05-01T00:00:00.000Z'
        }
    ]
}

function stampTransactions () {
    return [
        {
            id: 'tx-purchase',
            delta: 25,
            reason: 'purchase',
            balance_after: 25,
            created_at: '2026-05-03T00:00:00.000Z'
        },
        {
            id: 'tx-send',
            delta: -1,
            reason: 'send',
            balance_after: 24,
            created_at: '2026-05-02T00:00:00.000Z'
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
