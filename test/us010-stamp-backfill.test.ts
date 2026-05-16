import { describe, expect, it, vi } from 'vitest'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createCreditDbMock () {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql:string) => {
        if (sql.includes('INSERT INTO stamp_lots')) {
            return { rows: [{ id: 'lot-1' }] }
        }

        if (sql.includes('UPDATE users')) {
            return { rows: [{ stamps_balance: 10 }] }
        }

        return { rows: [] }
    })
    const connect = vi.fn(async () => {
        return { query, release }
    })

    vi.doMock('@netlify/database', () => ({
        getDatabase: () => ({ pool: { connect } })
    }))

    return { query }
}

describe('US-010 existing user stamp backfill', () => {
    it('records migration grants with a distinct reason', async () => {
        vi.resetModules()

        const db = createCreditDbMock()
        const { creditStampLot } = await import('../netlify/lib/stamps')

        await creditStampLot({
            userId: 'user-1',
            source: 'grant',
            count: 10,
            priceCents: null,
            transactionReason: 'migration_grant'
        })

        expect(db.query).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining('INSERT INTO stamp_transactions'),
            ['user-1', 'lot-1', 10, 'migration_grant', undefined, 10]
        )
    })

    it('credits only users missing the migration grant', async () => {
        vi.resetModules()

        const creditStampLot = vi.fn(async () => {
            return { lotId: 'lot-2', balanceAfter: 10 }
        })
        const query = vi.fn<Query>(async (sql:string, params?:unknown[]) => {
            if (sql.includes('FROM users')) {
                return {
                    rows: [
                        { id: 'user-1' },
                        { id: 'user-2' }
                    ]
                }
            }

            if (params?.[0] === 'user-1') {
                return { rows: [{ id: 'tx-1' }] }
            }

            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({ creditStampLot }))

        const module = await import('../netlify/lib/stamp-backfill')
        const result = await module.backfillExistingUserStamps()

        expect(creditStampLot).toHaveBeenCalledTimes(1)
        expect(creditStampLot).toHaveBeenCalledWith({
            userId: 'user-2',
            source: 'grant',
            count: 10,
            priceCents: null,
            transactionReason: 'migration_grant'
        })
        expect(result).toEqual({
            dryRun: false,
            usersProcessed: 2,
            usersSkipped: 1,
            stampsGranted: 10
        })
    })

    it('reports eligible grants without writing in dry-run mode', async () => {
        vi.resetModules()

        const logs:string[] = []
        const creditStampLot = vi.fn()
        const query = vi.fn<Query>(async (sql:string) => {
            if (sql.includes('FROM users')) {
                return {
                    rows: [
                        { id: 'user-1' },
                        { id: 'user-2' }
                    ]
                }
            }

            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({ pool: { query } })
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({ creditStampLot }))

        const module = await import('../netlify/lib/stamp-backfill')
        const result = await module.backfillExistingUserStamps({
            dryRun: true,
            log: (message:string) => logs.push(message)
        })

        expect(creditStampLot).not.toHaveBeenCalled()
        expect(result).toEqual({
            dryRun: true,
            usersProcessed: 2,
            usersSkipped: 0,
            stampsGranted: 20
        })
        expect(logs).toContain('Users processed: 2')
        expect(logs).toContain('Stamps granted: 20')
        expect(logs).toContain('Dry run: true')
    })
})
