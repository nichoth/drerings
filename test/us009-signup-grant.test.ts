import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-009 signup stamp grant', () => {
    it('credits 5 grant stamps when checkout creates a user', async () => {
        vi.resetModules()

        const creditStampLot = vi.fn(async () => {
            return { lotId: 'lot-1', balanceAfter: 5 }
        })
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'user-2',
                    email: 'new@example.com',
                    subscription_status: 'free',
                    autumn_customer_id: null,
                    stamps_balance: 0,
                    was_inserted: true
                }]
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({ creditStampLot }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.upsertCheckoutUser('new@example.com')

        expect(creditStampLot).toHaveBeenCalledWith({
            userId: 'user-2',
            source: 'grant',
            count: 5,
            priceCents: null
        })
        expect(result.stamps_balance).toBe(5)
    })

    it('does not credit signup stamps for an existing user', async () => {
        vi.resetModules()

        const creditStampLot = vi.fn()
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'user-1',
                    email: 'existing@example.com',
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
        const result = await store.upsertCheckoutUser('existing@example.com')

        expect(creditStampLot).not.toHaveBeenCalled()
        expect(result.stamps_balance).toBe(12)
    })
})
