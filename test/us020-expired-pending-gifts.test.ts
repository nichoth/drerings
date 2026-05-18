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

const event = {
    rawUrl: 'https://drerings.app/.netlify/functions/refund-expired-gifts',
    rawQuery: '',
    path: '/.netlify/functions/refund-expired-gifts',
    httpMethod: 'POST',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false
} satisfies HandlerEvent

const context = {} as HandlerContext

async function callHandler (
    handler:Handler
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-020 expired pending gift refunds', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('refunds pending gifts older than ninety days and emails senders',
        async () => {
            vi.resetModules()
            vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
            vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

            const sendRefundEmail = vi.fn(async () => {})
            const issueRefund = vi.fn(async () => {})
            const release = vi.fn()
            const query = vi.fn<Query>(async (sql) => {
                if (sql.includes('FROM pending_gifts')) {
                    return {
                        rows: [{
                            id: 'pending-gift-1',
                            sender_handle: 'sender.bsky.social',
                            recipient_email: 'friend@example.com',
                            autumn_checkout_id: 'checkout-gift-1',
                            price_cents: 1000
                        }]
                    }
                }

                return { rows: [] }
            })
            const clientQuery = vi.fn<Query>(async (sql) => {
                if (sql.includes('FROM pending_gifts')) {
                    return {
                        rows: [{
                            id: 'pending-gift-1',
                            sender_handle: 'sender.bsky.social',
                            recipient_email: 'friend@example.com',
                            autumn_checkout_id: 'checkout-gift-1',
                            price_cents: 1000
                        }]
                    }
                }

                if (sql.includes("SET status = 'refunded'")) {
                    return { rows: [{ id: 'pending-gift-1' }] }
                }

                return { rows: [] }
            })
            const connect = vi.fn(async () => {
                return {
                    query: clientQuery,
                    release
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query,
                        connect
                    }
                })
            }))

            const stamps = await import('../netlify/lib/stamps')
            const refundExpiredPendingGifts = (
                stamps as Record<string, unknown>
            ).refundExpiredPendingGifts

            expect(typeof refundExpiredPendingGifts).toBe('function')

            const result = await (
                refundExpiredPendingGifts as (options:{
                    issueRefund:typeof issueRefund;
                    sendRefundEmail:typeof sendRefundEmail;
                }) => Promise<unknown>
            )({
                issueRefund,
                sendRefundEmail
            })

            expect(result).toEqual({
                processed: 1,
                refunded: 1
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining("status = 'pending'"),
                []
            )
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining("now() - interval '90 days'"),
                []
            )
            expect(clientQuery).toHaveBeenCalledWith('BEGIN')
            expect(issueRefund).toHaveBeenCalledWith({
                checkoutId: 'checkout-gift-1',
                amountCents: 1000
            })
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining("SET status = 'refunded'"),
                ['pending-gift-1']
            )
            expect(clientQuery).toHaveBeenCalledWith('COMMIT')
            expect(release).toHaveBeenCalled()
            expect(sendRefundEmail).toHaveBeenCalledWith({
                email: 'sender.bsky.social@bsky.social',
                recipientEmail: 'friend@example.com'
            })
        })

    it('runs from a daily scheduled Netlify function', async () => {
        vi.resetModules()

        vi.spyOn(console, 'log').mockImplementation(() => undefined)

        const refundExpiredPendingGifts = vi.fn(async () => {
            return {
                processed: 2,
                refunded: 2
            }
        })

        const schedule = vi.fn((cron:string, handler:Handler) => {
            return handler
        })

        vi.doMock('@netlify/functions', () => ({
            schedule
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({
            refundExpiredPendingGifts
        }))
        vi.doMock('../netlify/lib/billing.js', () => ({
            issueAutumnStampRefund: vi.fn()
        }))
        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPendingGiftRefundEmail: vi.fn()
        }))

        const modulePath = '../netlify/functions/refund-expired-gifts'
        const { handler } = await import(
            modulePath
        )
        const response = await callHandler(handler)

        expect(schedule).toHaveBeenCalledWith(
            '0 9 * * *',
            expect.any(Function)
        )
        expect(refundExpiredPendingGifts).toHaveBeenCalledOnce()
        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            processed: 2,
            refunded: 2
        })
    })
})
