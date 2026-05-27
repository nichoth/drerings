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

describe('US-021 sent gifts UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows gift statuses and only refunds unused recent gifts',
        async () => {
            const state = signedInState()
            const fetcher = vi.fn(async (
                url:string,
                options?:RequestInit
            ) => {
                if (url === '/api/stamps-lots') {
                    return jsonResponse({
                        lots: [],
                        pending_gifts: [],
                        sent_gifts: sentGifts()
                    })
                }

                if (url === '/api/stamps-gifts-refund/lot-unused') {
                    expect(options?.method).toBe('POST')

                    return jsonResponse({
                        refund_cents: 1000
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
            const sentGiftsHeading = await within(stamps).findByRole(
                'heading',
                {
                    name: 'Sent gifts'
                }
            )

            expect(sentGiftsHeading).toBeTruthy()
            expect(within(stamps).getByText('friend.bsky.social'))
                .toBeTruthy()
            expect(within(stamps).getByText(
                'Unused (refundable until May 31, 2026)'
            )).toBeTruthy()
            expect(within(stamps).getByText('In use (final)')).toBeTruthy()

            const unusedGift = within(stamps).getByRole('listitem', {
                name: /friend.bsky.social/i
            })
            const usedGift = within(stamps).getByRole('listitem', {
                name: /pal.bsky.social/i
            })

            expect(within(unusedGift).getByRole('button', {
                name: 'Refund gift'
            })).toBeTruthy()
            expect(within(usedGift).queryByRole('button', {
                name: 'Refund gift'
            })).toBeNull()

            await fireEvent.click(within(unusedGift).getByRole('button', {
                name: 'Refund gift'
            }))

            expect(within(unusedGift).getByText(
                'Refund $10.00 for friend.bsky.social?'
            )).toBeTruthy()

            await fireEvent.click(within(unusedGift).getByRole('button', {
                name: 'Confirm gift refund'
            }))

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith(
                    '/api/stamps-gifts-refund/lot-unused',
                    { method: 'POST' }
                )
            })
            expect(await screen.findByText('Gift refunded $10.00.'))
                .toBeTruthy()
        })
})

function signedInState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'sender-1',
        did: 'did:plc:test-1',
        handle: 'sender.bsky.social',
        stamps_balance: 12
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
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
        },
        {
            id: 'lot-used',
            recipient_handle: 'pal.bsky.social',
            original_count: 25,
            remaining_count: 24,
            refund_cents: 0,
            refundable: false,
            refundable_until: '2026-05-31T00:00:00.000Z',
            status: 'in_use',
            created_at: '2026-05-01T00:00:00.000Z'
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
