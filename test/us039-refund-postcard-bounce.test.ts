import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { DatabaseClient } from '../netlify/lib/stamps.js'

describe('US-039 refundPostcardBounce orchestrator', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.resetModules()
    })

    it(
        'AC11.1: sent postcard → transitions to failed_refunded, ' +
        'refunds stamps, returns {refunded:true}',
        async () => {
            const queryLog:Array<{ sql:string; params?:unknown[] }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })

                    // BEGIN/COMMIT/ROLLBACK
                    if (
                        sql.toUpperCase() === 'BEGIN' ||
                        sql.toUpperCase() === 'COMMIT' ||
                        sql.toUpperCase() === 'ROLLBACK'
                    ) {
                        return { rows: [] } as any
                    }

                    // UPDATE postcards (CAS)
                    if (sql.includes('UPDATE postcards')) {
                        return {
                            rows: [{
                                sender_id: 'user-1',
                                lot_id: 'lot-1'
                            }]
                        } as any
                    }

                    // UPDATE stamp_lots
                    if (
                        sql.includes('UPDATE stamp_lots') &&
                        sql.includes('remaining_count = remaining_count + 1')
                    ) {
                        return { rows: [] } as any
                    }

                    // UPDATE users (balance query)
                    if (
                        sql.includes('UPDATE users') &&
                        sql.includes('stamps_balance = stamps_balance + 1')
                    ) {
                        return {
                            rows: [{ stamps_balance: '5' }]
                        } as any
                    }

                    // INSERT stamp_transactions
                    if (sql.includes('INSERT INTO stamp_transactions')) {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const fakePool = {
                connect: vi.fn(async () => fakeClient),
                query: vi.fn(async () => ({ rows: [] }))
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            const result = await refundPostcardBounce('postcard-1')

            expect(result).toEqual({
                refunded: true,
                balanceAfter: 5
            })

            // Verify transaction lifecycle
            const beginCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'BEGIN'
            )
            expect(beginCall).toBeDefined()

            const commitCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'COMMIT'
            )
            expect(commitCall).toBeDefined()

            // Verify release was called
            expect(fakeClient.release).toHaveBeenCalled()
        }
    )

    it(
        'AC11.2: already-refunded postcard → returns ' +
        '{refunded:false, reason:\'already_refunded\'}',
        async () => {
            const queryLog:Array<{ sql:string; params?:unknown[] }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })

                    // BEGIN/COMMIT/ROLLBACK
                    if (sql.toUpperCase() === 'BEGIN') {
                        return { rows: [] } as any
                    }

                    // UPDATE postcards returns no rows (CAS missed)
                    if (sql.includes('UPDATE postcards')) {
                        return { rows: [] } as any
                    }

                    if (sql.toUpperCase() === 'ROLLBACK') {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const fakePool = {
                connect: vi.fn(async () => fakeClient),
                query: vi.fn(async (sql:string) => {
                    // classifyMissedRefund SELECT
                    if (sql.includes('SELECT status FROM postcards')) {
                        return {
                            rows: [{ status: 'failed_refunded' }]
                        } as any
                    }
                    return { rows: [] } as any
                })
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            const result = await refundPostcardBounce('postcard-1')

            expect(result).toEqual({
                refunded: false,
                reason: 'already_refunded'
            })

            // Verify ROLLBACK was called (CAS missed)
            const rollbackCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'ROLLBACK'
            )
            expect(rollbackCall).toBeDefined()

            // Verify release was called
            expect(fakeClient.release).toHaveBeenCalled()
        }
    )

    it(
        'AC11.3: concurrent → exactly one refunds, one gets already_refunded',
        async () => {
            // Global counter for UPDATE postcards calls
            let updateCallCount = 0
            const statusUpdates:Record<number, string> = {
                0: 'failed_refunded', // First call marks it failed_refunded
                1: 'failed_refunded'  // Second call sees it as already_refunded
            }

            const createFakeClient = ():DatabaseClient => ({
                query: vi.fn(async (sql:string) => {
                    // BEGIN/COMMIT/ROLLBACK
                    if (
                        sql.toUpperCase() === 'BEGIN' ||
                        sql.toUpperCase() === 'COMMIT' ||
                        sql.toUpperCase() === 'ROLLBACK'
                    ) {
                        return { rows: [] } as any
                    }

                    // UPDATE postcards: first succeeds, second fails (CAS)
                    if (sql.includes('UPDATE postcards')) {
                        const isFirst = updateCallCount === 0
                        updateCallCount++

                        if (isFirst) {
                            return {
                                rows: [{
                                    sender_id: 'user-1',
                                    lot_id: 'lot-1'
                                }]
                            } as any
                        } else {
                            return { rows: [] } as any
                        }
                    }

                    // stamp_lots update
                    if (
                        sql.includes('UPDATE stamp_lots') &&
                        sql.includes('remaining_count = remaining_count + 1')
                    ) {
                        return { rows: [] } as any
                    }

                    // users balance update
                    if (
                        sql.includes('UPDATE users') &&
                        sql.includes('stamps_balance = stamps_balance + 1')
                    ) {
                        return {
                            rows: [{ stamps_balance: '5' }]
                        } as any
                    }

                    // stamp_transactions insert
                    if (sql.includes('INSERT INTO stamp_transactions')) {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            })

            const clients:Array<DatabaseClient> = []
            let poolCallCount = 0

            const fakePool = {
                connect: vi.fn(async () => {
                    const client = createFakeClient()
                    clients.push(client)
                    return client
                }),
                query: vi.fn(async (sql:string) => {
                    // classifyMissedRefund SELECT
                    if (sql.includes('SELECT status FROM postcards')) {
                        const callNumber = poolCallCount++
                        const status =
                            statusUpdates[callNumber] || 'failed_refunded'
                        return {
                            rows: [{ status }]
                        } as any
                    }
                    return { rows: [] } as any
                })
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            // Run two concurrent calls
            const results = await Promise.allSettled([
                refundPostcardBounce('postcard-1'),
                refundPostcardBounce('postcard-1')
            ])

            // Both should fulfill (one succeeds, one sees already_refunded)
            expect(results).toHaveLength(2)

            // Extract fulfilled results
            const values = results
                .filter((r):r is PromiseFulfilledResult<any> =>
                    r.status === 'fulfilled'
                )
                .map(r => r.value)

            expect(values).toHaveLength(2)

            // One should be refunded, one should be already_refunded
            const refundedResults = values.filter(v =>
                v && v.refunded === true
            )
            const alreadyRefundedResults = values.filter(v =>
                v && v.refunded === false && v.reason === 'already_refunded'
            )

            expect(refundedResults).toHaveLength(1)
            expect(alreadyRefundedResults).toHaveLength(1)

            expect(refundedResults[0].balanceAfter).toBe(5)

            // Both clients should have been released
            clients.forEach(client => {
                expect(client.release).toHaveBeenCalled()
            })
        }
    )

    it(
        'AC11.4: queued postcard → returns ' +
        '{refunded:false, reason:\'not_sent\'}',
        async () => {
            const queryLog:Array<{ sql:string; params?:unknown[] }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })

                    if (sql.toUpperCase() === 'BEGIN') {
                        return { rows: [] } as any
                    }

                    if (sql.includes('UPDATE postcards')) {
                        return { rows: [] } as any
                    }

                    if (sql.toUpperCase() === 'ROLLBACK') {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const fakePool = {
                connect: vi.fn(async () => fakeClient),
                query: vi.fn(async (sql:string) => {
                    if (sql.includes('SELECT status FROM postcards')) {
                        return { rows: [{ status: 'queued' }] } as any
                    }
                    return { rows: [] } as any
                })
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            const result = await refundPostcardBounce('postcard-1')

            expect(result).toEqual({
                refunded: false,
                reason: 'not_sent'
            })
        }
    )

    it(
        'AC11.5: unknown postcard id → returns ' +
        '{refunded:false, reason:\'not_sent\'}',
        async () => {
            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string) => {
                    if (sql.toUpperCase() === 'BEGIN') {
                        return { rows: [] } as any
                    }

                    if (sql.includes('UPDATE postcards')) {
                        return { rows: [] } as any
                    }

                    if (sql.toUpperCase() === 'ROLLBACK') {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const fakePool = {
                connect: vi.fn(async () => fakeClient),
                query: vi.fn(async (sql:string) => {
                    // SELECT returns no rows (unknown id)
                    if (sql.includes('SELECT status FROM postcards')) {
                        return { rows: [] } as any
                    }
                    return { rows: [] } as any
                })
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            const result = await refundPostcardBounce('unknown-id')

            expect(result).toEqual({
                refunded: false,
                reason: 'not_sent'
            })
        }
    )

    it(
        'AC11.6: inner refundFailedSend throws → ROLLBACK, ' +
        'no balance change, no transaction row',
        async () => {
            const queryLog:Array<{ sql:string; params?:unknown[] }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })

                    if (sql.toUpperCase() === 'BEGIN') {
                        return { rows: [] } as any
                    }

                    // UPDATE postcards succeeds
                    if (sql.includes('UPDATE postcards')) {
                        return {
                            rows: [{
                                sender_id: 'user-1',
                                lot_id: 'lot-1'
                            }]
                        } as any
                    }

                    if (sql.toUpperCase() === 'ROLLBACK') {
                        return { rows: [] } as any
                    }

                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const fakePool = {
                connect: vi.fn(async () => fakeClient)
            }

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: fakePool })
            }))

            // Mock refundFailedSend to throw
            const mockRefundFailedSend = vi.fn().mockRejectedValue(
                new Error('Refund service error')
            )

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    refundFailedSend: mockRefundFailedSend
                }
            })

            const { refundPostcardBounce } =
                await import('../netlify/lib/postcards.js')

            // Should throw the error
            await expect(refundPostcardBounce('postcard-1')).rejects.toThrow(
                'Refund service error'
            )

            // ROLLBACK should have been called
            const rollbackCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'ROLLBACK'
            )
            expect(rollbackCall).toBeDefined()

            // No INSERT INTO stamp_transactions should have occurred
            const stampTxInsert = queryLog.find(q =>
                q.sql.includes('INSERT INTO stamp_transactions')
            )
            expect(stampTxInsert).not.toBeDefined()

            // Client should be released
            expect(fakeClient.release).toHaveBeenCalled()

            // No COMMIT should exist
            const commitCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'COMMIT'
            )
            expect(commitCall).not.toBeDefined()
        }
    )
})
