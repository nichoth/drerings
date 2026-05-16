import { describe, expect, it, vi } from 'vitest'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createDbMock (balanceAfter = 15) {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql:string) => {
        if (sql.includes('INSERT INTO stamp_lots')) {
            return { rows: [{ id: 'lot-1' }] }
        }

        if (sql.includes('UPDATE users')) {
            return { rows: [{ stamps_balance: balanceAfter }] }
        }

        return { rows: [] }
    })
    const connect = vi.fn(async () => {
        return { query, release }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { connect }
            })
        }
    })

    return { connect, query, release }
}

describe('US-002 creditStampLot', () => {
    it.each([
        ['purchase', 'purchase', 500, 'checkout-1', undefined],
        ['grant', 'grant', null, undefined, undefined],
        ['gift_received', 'gift_received', null, undefined, 'user-2']
    ])(
        'credits %s lots and records the matching transaction',
        async (
            source,
            reason,
            priceCents,
            autumnCheckoutId,
            giftedByUserId
        ) => {
            vi.resetModules()

            const db = createDbMock()
            const { creditStampLot } = await import('../netlify/lib/stamps')
            const result = await creditStampLot({
                userId: 'user-1',
                source: source as 'purchase'|'grant'|'gift_received',
                count: 10,
                priceCents,
                autumnCheckoutId,
                giftedByUserId
            })

            expect(result).toEqual({
                lotId: 'lot-1',
                balanceAfter: 15
            })
            expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN')
            expect(db.query).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO stamp_lots'),
                [
                    'user-1',
                    source,
                    10,
                    priceCents,
                    autumnCheckoutId,
                    giftedByUserId
                ]
            )
            expect(db.query).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining(
                    'stamps_balance = stamps_balance + $1'
                ),
                [10, 'user-1']
            )
            expect(db.query).toHaveBeenNthCalledWith(
                4,
                expect.stringContaining('INSERT INTO stamp_transactions'),
                ['user-1', 'lot-1', 10, reason, autumnCheckoutId, 15]
            )
            expect(db.query).toHaveBeenNthCalledWith(5, 'COMMIT')
            expect(db.release).toHaveBeenCalled()
        }
    )

    it('rolls back and releases the client when a write fails', async () => {
        vi.resetModules()

        const db = createDbMock()

        db.query.mockImplementation(async (sql:string) => {
            if (sql.includes('UPDATE users')) {
                throw new Error('update failed')
            }

            if (sql.includes('INSERT INTO stamp_lots')) {
                return { rows: [{ id: 'lot-1' }] }
            }

            return { rows: [] }
        })

        const { creditStampLot } = await import('../netlify/lib/stamps')

        await expect(creditStampLot({
            userId: 'user-1',
            source: 'grant',
            count: 10
        })).rejects.toThrow('update failed')

        expect(db.query).toHaveBeenCalledWith('ROLLBACK')
        expect(db.release).toHaveBeenCalled()
    })
})
