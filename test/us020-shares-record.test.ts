import { describe, expect, it, vi } from 'vitest'

describe('recordShare', () => {
    it('free path: inserts with was_free=true and no debit', async () => {
        vi.resetModules()

        const queries:Array<{ sql:string; params?:unknown[] }> = []
        const release = vi.fn()

        const query = vi.fn(async (sql:string, params?:unknown[]) => {
            queries.push({ sql, params })

            if (sql.includes('FROM share_events')
                && sql.includes('idempotency_key = $2')) {
                // Early dup check
                return { rows: [] }
            }
            if (sql === 'BEGIN' || sql === 'COMMIT' ||
                sql === 'ROLLBACK') {
                return { rows: [] }
            }
            if (sql.includes('SELECT id FROM users')
                && sql.includes('FOR UPDATE')) {
                // Lock acquisition
                return { rows: [{ id: 'user-1' }] }
            }
            if (sql.includes('count(*)')
                && sql.includes('share_events')) {
                // Free count check
                return { rows: [{ count: '0' }] }
            }
            if (sql.includes('INSERT INTO share_events')) {
                // Free share insert
                return { rows: [{ id: 'event-1' }] }
            }
            if (sql.includes('stamps_balance FROM users')) {
                // Balance read
                return { rows: [{ stamps_balance: 3 }] }
            }
            if (sql.includes('UPDATE stamp_lots')) {
                // debitStamp lot selection (shouldn't happen on free)
                return { rows: [] }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: {
                    query,
                    connect: async () => ({
                        query,
                        release
                    })
                }
            })
        }))

        const { recordShare } = await import('../netlify/lib/shares')
        const result = await recordShare({
            userId: 'user-1',
            drawingId: 'drawing-1',
            timezone: 'UTC',
            idempotencyKey: 'idem-1'
        })

        expect(result).toEqual({
            type: 'recorded',
            was_free: true,
            stamps_balance: 3
        })

        // Verify INSERT INTO share_events was called with was_free=true
        const insertEvent = queries.find(q =>
            q.sql.includes('INSERT INTO share_events')
        )
        expect(insertEvent).toBeDefined()
        // Verify the SQL contains true literal (not passed as param)
        expect(insertEvent?.sql).toContain('VALUES ($1, $2, $3, $4, true, $5)')

        // Verify no INSERT INTO stamp_transactions
        const insertStamps = queries.find(q =>
            q.sql.includes('INSERT INTO stamp_transactions')
        )
        expect(insertStamps).toBeUndefined()
    })

    it('paid path: inserts with was_free=false and debits stamp',
        async () => {
            vi.resetModules()

            const queries:Array<{ sql:string; params?:unknown[] }> = []
            const release = vi.fn()

            const query = vi.fn(async (sql:string, params?:unknown[]) => {
                queries.push({ sql, params })

                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key = $2')) {
                    // Early dup check
                    return { rows: [] }
                }
                if (sql === 'BEGIN' || sql === 'COMMIT' ||
                    sql === 'ROLLBACK') {
                    return { rows: [] }
                }
                if (sql.includes('SELECT id FROM users')
                    && sql.includes('FOR UPDATE')) {
                    // Lock acquisition
                    return { rows: [{ id: 'user-1' }] }
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    // Free count check - free already used
                    return { rows: [{ count: '1' }] }
                }
                if (sql.includes('stamps_balance FROM users')) {
                    // Balance read - has stamps
                    return { rows: [{ stamps_balance: 5 }] }
                }
                if (sql.includes('INSERT INTO share_events')) {
                    // Paid share insert
                    return { rows: [{ id: 'event-2' }] }
                }
                if (sql.includes('UPDATE stamp_lots')) {
                    // debitStamp lot selection
                    return { rows: [{ id: 'lot-1' }] }
                }
                if (sql.includes('UPDATE users')
                    && sql.includes('stamps_balance')) {
                    // debitStamp balance update
                    return { rows: [{ stamps_balance: 4 }] }
                }
                if (sql.includes('INSERT INTO stamp_transactions')) {
                    // debitStamp transaction insert
                    return { rows: [{ id: 'txn-1' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query,
                        connect: async () => ({
                            query,
                            release
                        })
                    }
                })
            }))

            const { recordShare } = await import('../netlify/lib/shares')
            const result = await recordShare({
                userId: 'user-1',
                drawingId: 'drawing-2',
                timezone: 'UTC',
                idempotencyKey: 'idem-2'
            })

            expect(result).toEqual({
                type: 'recorded',
                was_free: false,
                stamps_balance: 4
            })

            // Verify INSERT INTO share_events was called with was_free=false
            const insertEvent = queries.find(q =>
                q.sql.includes('INSERT INTO share_events')
            )
            expect(insertEvent).toBeDefined()
            // Verify the SQL contains false literal (not passed as param)
            expect(insertEvent?.sql).toContain('VALUES ($1, $2, $3, $4, false, $5)')

            // Verify INSERT INTO stamp_transactions with reason='share'
            const insertStamps = queries.find(q =>
                q.sql.includes('INSERT INTO stamp_transactions')
            )
            expect(insertStamps).toBeDefined()
            expect(insertStamps?.params).toEqual(
                expect.arrayContaining(['share'])
            )
            // referenceId should be the inserted event ID
            expect(insertStamps?.params).toEqual(
                expect.arrayContaining(['event-2'])
            )
        }
    )

    it('blocked path: returns blocked when no free and no stamps',
        async () => {
            vi.resetModules()

            const queries:Array<{ sql:string; params?:unknown[] }> = []
            const release = vi.fn()

            const query = vi.fn(async (sql:string, params?:unknown[]) => {
                queries.push({ sql, params })

                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key = $2')) {
                    // Early dup check
                    return { rows: [] }
                }
                if (sql === 'BEGIN' || sql === 'COMMIT' ||
                    sql === 'ROLLBACK') {
                    return { rows: [] }
                }
                if (sql.includes('SELECT id FROM users')
                    && sql.includes('FOR UPDATE')) {
                    // Lock acquisition
                    return { rows: [{ id: 'user-1' }] }
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    // Free count check - free already used
                    return { rows: [{ count: '1' }] }
                }
                if (sql.includes('stamps_balance FROM users')) {
                    // Balance read - no stamps
                    return { rows: [{ stamps_balance: 0 }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query,
                        connect: async () => ({
                            query,
                            release
                        })
                    }
                })
            }))

            const { recordShare } = await import('../netlify/lib/shares')
            const result = await recordShare({
                userId: 'user-1',
                drawingId: 'drawing-3',
                timezone: 'UTC',
                idempotencyKey: 'idem-3'
            })

            expect(result).toEqual({
                type: 'blocked',
                reason: 'no_free_no_stamps'
            })

            // Verify no INSERT INTO share_events
            const insertEvent = queries.find(q =>
                q.sql.includes('INSERT INTO share_events')
            )
            expect(insertEvent).toBeUndefined()

            // Verify ROLLBACK was called
            const rollback = queries.find(q => q.sql === 'ROLLBACK')
            expect(rollback).toBeDefined()
        }
    )

    it('serializes concurrent confirms: first free, second blocked',
        async () => {
            vi.resetModules()

            let freeCount = 0
            const queries:Array<{ sql:string; params?:unknown[] }> = []
            const release = vi.fn()

            const query = vi.fn(async (sql:string, params?:unknown[]) => {
                queries.push({ sql, params })

                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key = $2')) {
                    // Early dup check - no prior event
                    return { rows: [] }
                }
                if (sql === 'BEGIN' || sql === 'COMMIT' ||
                    sql === 'ROLLBACK') {
                    return { rows: [] }
                }
                if (sql.includes('SELECT id FROM users')
                    && sql.includes('FOR UPDATE')) {
                    // Lock acquisition
                    return { rows: [{ id: 'user-1' }] }
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    // First call sees 0 (free), second sees 1 (after first
                    // tx commits)
                    const c = freeCount
                    return { rows: [{ count: String(c) }] }
                }
                if (sql.includes('INSERT INTO share_events')) {
                    // Detect if this is free or paid based on SQL content
                    if (sql.includes(', true,')) {
                        // Free path: update counter so second call sees free used
                        freeCount = 1
                        return { rows: [{ id: 'event-1' }] }
                    }
                    if (sql.includes(', false,')) {
                        // Paid path
                        return { rows: [{ id: 'event-2' }] }
                    }
                    return { rows: [{ id: 'event-' + queries.length }] }
                }
                if (sql.includes('stamps_balance FROM users')) {
                    // Balance read - no stamps available
                    return { rows: [{ stamps_balance: 0 }] }
                }
                if (sql.includes('UPDATE stamp_lots')) {
                    // debitStamp lot selection
                    return { rows: [{ id: 'lot-1' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query,
                        connect: async () => ({
                            query,
                            release
                        })
                    }
                })
            }))

            const { recordShare } = await import('../netlify/lib/shares')

            // First call - free path
            const first = await recordShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })
            expect(first).toEqual(expect.objectContaining({
                type: 'recorded',
                was_free: true
            }))

            // Second call - should see free_count=1 and be blocked
            const second = await recordShare({
                userId: 'user-1',
                drawingId: 'drawing-2',
                timezone: 'UTC',
                idempotencyKey: 'idem-2'
            })
            expect(second).toEqual({
                type: 'blocked',
                reason: 'no_free_no_stamps'
            })
        }
    )
})
