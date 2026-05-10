import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('upsertCheckoutUser', () => {
    it('inserts a new free-status user when email is unknown', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'user-2',
                    email: 'new@example.com',
                    subscription_status: 'free',
                    autumn_customer_id: null
                }]
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))

        const store = await import('../netlify/lib/auth-store')
        const result = await store.upsertCheckoutUser('new@example.com')

        expect(result).toEqual({
            id: 'user-2',
            email: 'new@example.com',
            subscription_status: 'free',
            autumn_customer_id: null
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO users'),
            ['new@example.com']
        )
    })
})
