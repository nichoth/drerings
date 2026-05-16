import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-019 pending gift signup conversion', () => {
    it('claims pending gifts when the recipient signs up', async () => {
        vi.resetModules()

        const creditStampLot = vi.fn(async (
            options:Record<string, unknown>
        ) => {
            if (options.source === 'grant') {
                return { lotId: 'signup-grant-lot', balanceAfter: 5 }
            }

            if (options.autumnCheckoutId === 'checkout-gift-1') {
                return { lotId: 'gift-lot-1', balanceAfter: 30 }
            }

            return { lotId: 'gift-lot-2', balanceAfter: 40 }
        })
        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('INSERT INTO users')) {
                return {
                    rows: [{
                        id: 'recipient-1',
                        email: 'new@example.com',
                        subscription_status: 'free',
                        autumn_customer_id: null,
                        stamps_balance: 0,
                        was_inserted: true
                    }]
                }
            }

            if (sql.includes('FROM pending_gifts')) {
                return {
                    rows: [{
                        id: 'pending-gift-1',
                        sender_user_id: 'sender-1',
                        count: 25,
                        price_cents: 1000,
                        autumn_checkout_id: 'checkout-gift-1'
                    }, {
                        id: 'pending-gift-2',
                        sender_user_id: 'sender-2',
                        count: 10,
                        price_cents: 500,
                        autumn_checkout_id: 'checkout-gift-2'
                    }]
                }
            }

            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({ creditStampLot }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.upsertCheckoutUser('new@example.com')

        expect(creditStampLot).toHaveBeenNthCalledWith(1, {
            userId: 'recipient-1',
            source: 'grant',
            count: 5,
            priceCents: null
        })
        expect(creditStampLot).toHaveBeenNthCalledWith(2, {
            userId: 'recipient-1',
            source: 'gift_received',
            count: 25,
            priceCents: 1000,
            autumnCheckoutId: 'checkout-gift-1',
            giftedByUserId: 'sender-1'
        })
        expect(creditStampLot).toHaveBeenNthCalledWith(3, {
            userId: 'recipient-1',
            source: 'gift_received',
            count: 10,
            priceCents: 500,
            autumnCheckoutId: 'checkout-gift-2',
            giftedByUserId: 'sender-2'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM pending_gifts'),
            ['new@example.com']
        )
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("SET status = 'claimed'"),
            ['pending-gift-1']
        )
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("SET status = 'claimed'"),
            ['pending-gift-2']
        )
        expect(result.stamps_balance).toBe(40)
    })

    it('does not claim pending gifts for an existing user', async () => {
        vi.resetModules()

        const creditStampLot = vi.fn()
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'recipient-1',
                    email: 'new@example.com',
                    subscription_status: 'free',
                    autumn_customer_id: null,
                    stamps_balance: 12,
                    was_inserted: false
                }]
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({ creditStampLot }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.upsertCheckoutUser('new@example.com')

        expect(creditStampLot).not.toHaveBeenCalled()
        expect(query).toHaveBeenCalledTimes(1)
        expect(result.stamps_balance).toBe(12)
    })
})
