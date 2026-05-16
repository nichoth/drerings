import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const context = {} as HandlerContext

describe('US-018 pending gift checkout API', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('starts checkout for an email recipient without an account',
        async () => {
            vi.resetModules()
            vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
            vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

            const query = vi.fn<Query>(async () => ({ rows: [] }))
            const fetcher = vi.fn(async () => {
                return new Response(JSON.stringify({
                    url: 'https://checkout.stripe.com/pay/pending-gift-1',
                    customer_id: 'autumn-sender-1'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            })

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            const { handler } = await import(
                '../netlify/functions/stamps/gifts/checkout'
            )
            const response = await callHandler(handler, event({
                product_id: 'stamps_bundle',
                recipient: 'new-friend@example.com'
            }))

            expect(response.statusCode).toBe(200)
            expect(JSON.parse(response.body || '{}')).toEqual({
                url: 'https://checkout.stripe.com/pay/pending-gift-1',
                recipient: {
                    email: 'new-friend@example.com',
                    pending: true
                }
            })
            expect(fetcher).toHaveBeenCalledWith(
                'https://api.useautumn.test/checkout',
                expect.objectContaining({
                    body: JSON.stringify({
                        customer_id: 'sender-1',
                        product_id: 'stamps_bundle',
                        success_url:
                            'https://drerings.app/account?status=ok',
                        customer_data: {
                            email: 'sender@example.com'
                        },
                        metadata: {
                            gift_sender_user_id: 'sender-1',
                            gift_sender_email: 'sender@example.com',
                            gift_pending_recipient_email:
                                'new-friend@example.com'
                        },
                        checkout_session_params: {
                            cancel_url:
                                'https://drerings.app/account?status=cancel'
                        }
                    })
                })
            )
        })
})

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

function event (body:Record<string, unknown>):HandlerEvent {
    return {
        rawUrl: 'https://drerings.app/api/stamps/gifts/checkout',
        rawQuery: '',
        path: '/api/stamps/gifts/checkout',
        httpMethod: 'POST',
        headers: { host: 'drerings.app' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: JSON.stringify(body),
        isBase64Encoded: false
    }
}

function sender () {
    return {
        id: 'sender-1',
        email: 'sender@example.com',
        subscription_status: 'active' as const,
        stamps_balance: 12
    }
}
