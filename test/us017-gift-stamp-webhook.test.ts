import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-017 gift stamp webhook', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('credits the recipient and records the sender gift transaction',
        async () => {
            vi.resetModules()

            const sendStampGiftEmail = vi.fn(async () => {})
            const query = vi.fn<Query>(async () => ({ rows: [] }))
            const clientQuery = vi.fn<Query>(async (sql, params) => {
                if (sql.includes('INSERT INTO stamp_lots')) {
                    return { rows: [{ id: 'lot-gift' }] }
                }

                if (
                    sql.includes('UPDATE users') &&
                    params?.includes('recipient-1')
                ) {
                    return { rows: [{ stamps_balance: 30 }] }
                }

                if (
                    sql.includes('SELECT stamps_balance') &&
                    sql.includes('FROM users')
                ) {
                    return { rows: [{ stamps_balance: 12 }] }
                }

                return { rows: [] }
            })
            const release = vi.fn()
            const connect = vi.fn(async () => {
                return { query: clientQuery, release }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query, connect }
                    })
                }
            })
            vi.doMock('../netlify/lib/resend.js', () => {
                return { sendStampGiftEmail }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing'
            )
            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-gift-1',
                    product_id: '25_stamps',
                    customer: {
                        id: 'sender-1'
                    },
                    metadata: {
                        gift_sender_user_id: 'sender-1',
                        gift_sender_handle: 'sender.bsky.social',
                        gift_recipient_user_id: 'recipient-1',
                        gift_recipient_handle: 'alice.bsky.social'
                    }
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'gift_credited'
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('FROM stamp_transactions'),
                ['checkout-gift-1']
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_lots'),
                [
                    'recipient-1',
                    'gift_received',
                    25,
                    1000,
                    'checkout-gift-1',
                    'sender-1'
                ]
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_transactions'),
                [
                    'recipient-1',
                    'lot-gift',
                    25,
                    'gift_received',
                    'checkout-gift-1',
                    30
                ]
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_transactions'),
                [
                    'sender-1',
                    null,
                    0,
                    'gift_sent',
                    'checkout-gift-1',
                    12
                ]
            )
            expect(sendStampGiftEmail).toHaveBeenCalledWith({
                email: 'alice.bsky.social@bsky.social',
                senderEmail: 'sender.bsky.social@bsky.social',
                count: 25
            })
            expect(clientQuery).toHaveBeenCalledWith('COMMIT')
            expect(release).toHaveBeenCalled()
        })

    it('treats webhook with missing gift metadata as direct purchase',
        async () => {
            vi.resetModules()

            const sendStampGiftEmail = vi.fn()
            const query = vi.fn<Query>(async (sql, _params) => {
                if (sql.includes('SELECT stamps_balance')) {
                    return { rows: [{ stamps_balance: 50 }] }
                }

                return { rows: [] }
            })
            const clientQuery = vi.fn<Query>(async (sql, _params) => {
                if (sql.includes('INSERT INTO stamp_lots')) {
                    return { rows: [{ id: 'lot-direct' }] }
                }

                if (sql.includes('UPDATE users')) {
                    return { rows: [{ stamps_balance: 75 }] }
                }

                return { rows: [] }
            })
            const release = vi.fn()
            const connect = vi.fn(async () => {
                return { query: clientQuery, release }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query, connect }
                    })
                }
            })
            vi.doMock('../netlify/lib/resend.js', () => {
                return { sendStampGiftEmail }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing'
            )
            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-direct-1',
                    product_id: '10_stamps',
                    customer: {
                        id: 'buyer-1'
                    },
                    metadata: {}
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'credited'
            })
            expect(sendStampGiftEmail).not.toHaveBeenCalled()
        })
})
