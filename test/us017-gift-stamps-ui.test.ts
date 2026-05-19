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

describe('US-017 gift stamps UI', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('selects a pack and starts a gift checkout for a recipient',
        async () => {
            const state = signedInState()
            const assign = vi.fn()
            const fetcher = vi.fn(async (
                url:string,
                options?:RequestInit
            ) => {
                if (url === '/api/stamps/lots') {
                    return jsonResponse({ lots: [] })
                }

                if (url === '/api/stamps/gifts/checkout') {
                    expect(options?.method).toBe('POST')

                    return jsonResponse({
                        url: 'https://checkout.stripe.com/pay/gift-1',
                        recipient: {
                            id: 'recipient-1',
                            handle: 'alice.bsky.social',
                            did: 'did:plc:abc'
                        }
                    })
                }

                throw new Error(`Unexpected fetch: ${url}`)
            })

            vi.stubGlobal('fetch', fetcher)
            vi.stubGlobal('location', {
                ...window.location,
                assign
            })

            const Route = routeFor('/settings', state)

            render(h(Route, { state }))

            const gift = await screen.findByRole('region', {
                name: 'Gift stamps'
            })
            const recipient = within(gift).getByLabelText(
                'Recipient email or username'
            )

            await fireEvent.input(recipient, {
                target: { value: 'alice.bsky.social' }
            })
            await fireEvent.click(within(gift).getByLabelText('25 stamps'))
            await fireEvent.click(within(gift).getByRole('button', {
                name: /continue to checkout/i
            }))

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith(
                    '/api/stamps/gifts/checkout',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            product_id: '25_stamps',
                            recipient: 'alice.bsky.social'
                        })
                    }
                )
                expect(assign).toHaveBeenCalledWith(
                    'https://checkout.stripe.com/pay/gift-1'
                )
            })
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
