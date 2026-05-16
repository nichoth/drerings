import { describe, expect, it, vi } from 'vitest'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createDbMock (balanceAfter = 7) {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql:string) => {
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

describe('US-004 refundFailedSend', () => {
    it('re-credits the spent lot and records the refund transaction',
        async () => {
            vi.resetModules()

            const db = createDbMock()
            const { refundFailedSend } = await import('../netlify/lib/stamps')
            const result = await refundFailedSend({
                userId: 'user-1',
                lotId: 'lot-1'
            })

            expect(result).toEqual({
                lotId: 'lot-1',
                balanceAfter: 7
            })
            expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN')
            expect(db.query).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining(
                    'remaining_count = remaining_count + 1'
                ),
                ['lot-1', 'user-1']
            )
            expect(db.query).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining(
                    'stamps_balance = stamps_balance + 1'
                ),
                ['user-1']
            )
            expect(db.query).toHaveBeenNthCalledWith(
                4,
                expect.stringContaining('INSERT INTO stamp_transactions'),
                [
                    'user-1',
                    'lot-1',
                    1,
                    'failed_send_refund',
                    undefined,
                    7
                ]
            )
            expect(db.query).toHaveBeenNthCalledWith(5, 'COMMIT')
            expect(db.release).toHaveBeenCalled()
        }
    )

    it('rolls back and releases the client when the refund write fails',
        async () => {
            vi.resetModules()

            const db = createDbMock()

            db.query.mockImplementation(async (sql:string) => {
                if (sql.includes('UPDATE users')) {
                    throw new Error('balance update failed')
                }

                return { rows: [] }
            })

            const { refundFailedSend } = await import('../netlify/lib/stamps')

            await expect(refundFailedSend({
                userId: 'user-1',
                lotId: 'lot-1'
            })).rejects.toThrow('balance update failed')

            expect(db.query).toHaveBeenCalledWith('ROLLBACK')
            expect(db.release).toHaveBeenCalled()
        }
    )
})
