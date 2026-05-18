import { describe, expect, it, vi } from 'vitest'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createDbMock (options:{
    selectedLotIds?:Array<string|null>;
    balanceAfter?:number;
} = {}) {
    const release = vi.fn()
    const selectedLotIds = [...(options.selectedLotIds ?? ['lot-grant'])]
    const balanceAfter = options.balanceAfter ?? 4
    const queries:Array<{ sql:string; params?:unknown[] }> = []
    const query = vi.fn<Query>(async (sql:string, params?:unknown[]) => {
        queries.push({ sql, params })

        if (sql.includes('UPDATE stamp_lots')) {
            const selectedLotId = selectedLotIds.shift()

            return { rows: selectedLotId ? [{ id: selectedLotId }] : [] }
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

    return { connect, query, queries, release }
}

describe('US-003 debitStamp', () => {
    it('debits the first available non-purchase lot with row locking',
        async () => {
            vi.resetModules()

            const db = createDbMock()
            const { debitStamp } = await import('../netlify/lib/stamps')
            const result = await debitStamp({ userId: 'user-1' })

            expect(result).toEqual({
                lotId: 'lot-grant',
                balanceAfter: 4
            })
            expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN')
            expect(db.query).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('FOR UPDATE SKIP LOCKED'),
                ['user-1']
            )
            expect(db.queries[1].sql).toContain(
                "CASE source WHEN 'purchase' THEN 1 ELSE 0 END"
            )
            expect(db.queries[1].sql).toContain('created_at ASC')
            expect(db.query).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining(
                    'stamps_balance = stamps_balance - 1'
                ),
                ['user-1']
            )
            expect(db.queries[2].sql).toContain('WHERE id = $1')
            expect(db.queries[2].sql).toContain('stamps_balance > 0')
            expect(db.query).toHaveBeenNthCalledWith(
                4,
                expect.stringContaining('INSERT INTO stamp_transactions'),
                ['user-1', 'lot-grant', -1, 'send', undefined, 4]
            )
            expect(db.query).toHaveBeenNthCalledWith(5, 'COMMIT')
            expect(db.release).toHaveBeenCalled()
        }
    )

    it('throws InsufficientStampsError when no lot is available', async () => {
        vi.resetModules()

        const db = createDbMock({ selectedLotIds: [null] })
        const { debitStamp, InsufficientStampsError } = await import(
            '../netlify/lib/stamps'
        )

        await expect(debitStamp({ userId: 'user-1' })).rejects.toBeInstanceOf(
            InsufficientStampsError
        )

        expect(db.query).toHaveBeenCalledWith('ROLLBACK')
        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users'),
            expect.anything()
        )
        expect(db.release).toHaveBeenCalled()
    })

    it('allows only one concurrent debit against a single available lot',
        async () => {
            vi.resetModules()

            const db = createDbMock({
                selectedLotIds: ['lot-1', null],
                balanceAfter: 0
            })
            const { debitStamp, InsufficientStampsError } = await import(
                '../netlify/lib/stamps'
            )
            const results = await Promise.allSettled([
                debitStamp({ userId: 'user-1' }),
                debitStamp({ userId: 'user-1' })
            ])

            expect(results).toEqual([
                {
                    status: 'fulfilled',
                    value: { lotId: 'lot-1', balanceAfter: 0 }
                },
                {
                    status: 'rejected',
                    reason: expect.any(InsufficientStampsError)
                }
            ])
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('FOR UPDATE SKIP LOCKED'),
                ['user-1']
            )
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('stamps_balance > 0'),
                ['user-1']
            )
        }
    )

    it('records reason=share when reason option is share', async () => {
        vi.resetModules()

        const db = createDbMock()
        const { debitStamp } = await import('../netlify/lib/stamps')

        await debitStamp({
            userId: 'user-1',
            referenceId: 'share-event-1',
            reason: 'share'
        })

        const insertCall = db.queries.find(q =>
            q.sql.includes('INSERT INTO stamp_transactions')
        )

        expect(insertCall).toBeDefined()
        expect(insertCall?.params).toEqual(
            expect.arrayContaining(['share'])
        )
        expect(insertCall?.params).toEqual(
            expect.arrayContaining(['share-event-1'])
        )
    })

    it('defaults reason to send when not provided', async () => {
        vi.resetModules()

        const db = createDbMock()
        const { debitStamp } = await import('../netlify/lib/stamps')

        await debitStamp({ userId: 'user-1' })

        const insertCall = db.queries.find(q =>
            q.sql.includes('INSERT INTO stamp_transactions')
        )

        expect(insertCall?.params).toEqual(
            expect.arrayContaining(['send'])
        )
    })
})
