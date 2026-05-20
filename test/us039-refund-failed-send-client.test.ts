import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { DatabaseClient } from '../netlify/lib/stamps.js'

describe('US-039 refundFailedSend with optional client parameter', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.resetModules()
    })

    it(
        'AC10.1: with client → runs on caller transaction, ' +
        'no BEGIN/COMMIT/ROLLBACK/release',
        async () => {
            const queryLog:Array<{
                sql:string;
                params?:unknown[];
            }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })
                    // Return appropriate shape for each query
                    if (sql.includes('UPDATE users')) {
                        return {
                            rows: [{ stamps_balance: '5' }]
                        } as any
                    }
                    return { rows: [] } as any
                }),
                release: vi.fn()
            }

            const { refundFailedSend } =
                await import('../netlify/lib/stamps.js')

            const result = await refundFailedSend({
                userId: 'user-1',
                lotId: 'lot-1',
                client: fakeClient
            })

            // Should NOT call BEGIN, COMMIT, or ROLLBACK
            const beginCommitRollback = queryLog.filter(q =>
                q.sql.toUpperCase().match(/^(BEGIN|COMMIT|ROLLBACK)/)
            )
            expect(beginCommitRollback).toHaveLength(0)

            // Should NOT call release()
            expect(fakeClient.release).not.toHaveBeenCalled()

            // Should call three queries: UPDATE stamp_lots, UPDATE users, INSERT
            expect(queryLog).toHaveLength(3)
            expect(queryLog[0].sql).toContain('UPDATE stamp_lots')
            expect(queryLog[1].sql).toContain('UPDATE users')
            expect(queryLog[2].sql).toContain('INSERT INTO stamp_transactions')

            // Should return correct shape
            expect(result).toEqual({
                lotId: 'lot-1',
                balanceAfter: 5
            })
        }
    )

    it(
        'AC10.2: without client → manages own transaction with ' +
        'BEGIN/COMMIT/release',
        async () => {
            const queryLog:Array<{
                sql:string;
                params?:unknown[];
            }> = []

            const fakeClient:DatabaseClient = {
                query: vi.fn(async (sql:string, params?:unknown[]) => {
                    queryLog.push({ sql, params })
                    if (sql.includes('UPDATE users')) {
                        return {
                            rows: [{ stamps_balance: '6' }]
                        } as any
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

            // Fresh import to get mocked getDatabase
            const { refundFailedSend } =
                await import('../netlify/lib/stamps.js')

            const result = await refundFailedSend({
                userId: 'user-1',
                lotId: 'lot-1'
            })

            // Should call BEGIN
            const beginCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'BEGIN'
            )
            expect(beginCall).toBeDefined()

            // Should call COMMIT
            const commitCall = queryLog.find(q =>
                q.sql.toUpperCase() === 'COMMIT'
            )
            expect(commitCall).toBeDefined()

            // Should call release()
            expect(fakeClient.release).toHaveBeenCalled()

            // Should have three domain queries + BEGIN + COMMIT
            const domainQueries = queryLog.filter(q =>
                !q.sql.toUpperCase().match(/^(BEGIN|COMMIT|ROLLBACK)/)
            )
            expect(domainQueries).toHaveLength(3)
            expect(domainQueries[0].sql).toContain('UPDATE stamp_lots')
            expect(domainQueries[1].sql).toContain('UPDATE users')
            expect(domainQueries[2].sql).toContain('INSERT INTO stamp_transactions')

            // Should return correct shape
            expect(result).toEqual({
                lotId: 'lot-1',
                balanceAfter: 6
            })
        }
    )
})
