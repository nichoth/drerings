import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{
    rows:Array<Record<string, unknown>>
    rowCount:number
}>

describe('US-035 stamp invariant alerts persistence', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('AC10.1 + AC10.2: inserts drift alerts on detection',
        async () => {
            vi.resetModules()

            const consoleError = vi.spyOn(console, 'error')
                .mockImplementation(() => undefined)

            let queryCount = 0
            const query = vi.fn<Query>(async (_sql:string) => {
                queryCount += 1
                // First query is the verification SELECT
                if (queryCount === 1) {
                    return {
                        rows: [{
                            user_id: 'user-1',
                            cached_balance: 5,
                            lot_balance: 4,
                            transaction_balance: 5
                        }],
                        rowCount: 1
                    }
                }
                // Subsequent queries are INSERT into stamp_invariant_alerts
                return {
                    rows: [{ id: 'alert-' + queryCount }],
                    rowCount: 1
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { verifyStampInvariants } = await import(
                '../netlify/lib/stamps'
            )
            await verifyStampInvariants()

            // Should have called INSERT for each drift
            const insertCalls = query.mock.calls.filter(
                call => call[0]?.includes('stamp_invariant_alerts')
            )
            expect(insertCalls).toHaveLength(1)

            // The drift: lot_balance mismatch
            expect(insertCalls[0][1]).toEqual([
                'user-1',
                'lot_balance',
                4,
                5
            ])

            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant verification alert.',
                expect.objectContaining({
                    driftCount: 1,
                    alertsRecorded: 1
                })
            )
        })

    it('AC10.3: only counts newly-inserted alerts', async () => {
        vi.resetModules()

        const consoleError = vi.spyOn(console, 'error')
            .mockImplementation(() => undefined)

        let insertCallCount = 0
        const query = vi.fn<Query>(async (sql:string) => {
            if (sql.includes('FROM users')) {
                // Initial verification query with one drift
                return {
                    rows: [{
                        user_id: 'user-1',
                        cached_balance: 5,
                        lot_balance: 4,
                        transaction_balance: 5
                    }],
                    rowCount: 1
                }
            }
            // INSERT into stamp_invariant_alerts
            insertCallCount += 1
            // Simulate ON CONFLICT firing on second attempt
            // (but we only have one drift, so no second attempt)
            return {
                rows: [{ id: 'alert-1' }],
                rowCount: 1
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { verifyStampInvariants } = await import(
            '../netlify/lib/stamps'
        )
        await verifyStampInvariants()

        // Should have called INSERT once for the drift
        expect(insertCallCount).toBe(1)

        expect(consoleError).toHaveBeenCalledWith(
            'Stamp invariant verification alert.',
            expect.objectContaining({
                driftCount: 1,
                alertsRecorded: 1
            })
        )
    })

    it('AC10.3: handles ON CONFLICT returning rowCount 0',
        async () => {
            vi.resetModules()

            const consoleError = vi.spyOn(console, 'error')
                .mockImplementation(() => undefined)

            let insertCount = 0
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('FROM users')) {
                    // Two drifts for same user, different invariants
                    return {
                        rows: [{
                            user_id: 'user-1',
                            cached_balance: 5,
                            lot_balance: 4,
                            transaction_balance: 3
                        }],
                        rowCount: 1
                    }
                }
                // INSERT into stamp_invariant_alerts
                insertCount += 1
                // First insert succeeds, second hits unique constraint
                if (insertCount === 1) {
                    return {
                        rows: [{ id: 'alert-1' }],
                        rowCount: 1
                    }
                }
                // Second insert: ON CONFLICT fires, rowCount is 0
                return {
                    rows: [],
                    rowCount: 0
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { verifyStampInvariants } = await import(
                '../netlify/lib/stamps'
            )
            await verifyStampInvariants()

            // Should have attempted two inserts
            expect(insertCount).toBe(2)

            // But only one was recorded (the second hit the constraint)
            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant verification alert.',
                expect.objectContaining({
                    driftCount: 2,
                    alertsRecorded: 1
                })
            )
        })

    it('AC10.4: no inserts when clean', async () => {
        vi.resetModules()

        const consoleError = vi.spyOn(console, 'error')
            .mockImplementation(() => undefined)
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    user_id: 'user-1',
                    cached_balance: 5,
                    lot_balance: 5,
                    transaction_balance: 5
                }, {
                    user_id: 'user-2',
                    cached_balance: 10,
                    lot_balance: 10,
                    transaction_balance: 10
                }],
                rowCount: 2
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { verifyStampInvariants } = await import(
            '../netlify/lib/stamps'
        )
        const result = await verifyStampInvariants()

        expect(result.driftCount).toBe(0)
        expect(result.drifts).toHaveLength(0)

        // Should not have called INSERT when there are no drifts
        const insertCalls = query.mock.calls.filter(
            call => call[0]?.includes('stamp_invariant_alerts')
        )
        expect(insertCalls).toHaveLength(0)

        // Should not emit the alert summary when driftCount is 0
        expect(consoleError).not.toHaveBeenCalledWith(
            'Stamp invariant verification alert.',
            expect.anything()
        )
    })

    it('AC11.1: response shape is unchanged', async () => {
        vi.resetModules()

        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    user_id: 'user-1',
                    cached_balance: 5,
                    lot_balance: 4,
                    transaction_balance: 5
                }],
                rowCount: 1
            }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { verifyStampInvariants } = await import(
            '../netlify/lib/stamps'
        )
        const result = await verifyStampInvariants()

        // Response must include only usersChecked, driftCount, drifts
        // (no alertsRecorded in the response shape)
        expect(result).toEqual({
            usersChecked: 1,
            driftCount: 1,
            drifts: [{
                userId: 'user-1',
                invariant: 'lot_balance',
                expected: 4,
                actual: 5
            }]
        })
        // Verify no additional fields
        expect(Object.keys(result)).toEqual([
            'usersChecked',
            'driftCount',
            'drifts'
        ])
    })

    it('AC11.2: existing console.error is still emitted',
        async () => {
            vi.resetModules()

            const consoleError = vi.spyOn(console, 'error')
                .mockImplementation(() => undefined)
            const query = vi.fn<Query>(async () => {
                return {
                    rows: [{
                        user_id: 'user-1',
                        cached_balance: 5,
                        lot_balance: 4,
                        transaction_balance: 5
                    }],
                    rowCount: 1
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { verifyStampInvariants } = await import(
                '../netlify/lib/stamps'
            )
            await verifyStampInvariants()

            // Should emit the original drift-detected message
            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant drift detected.',
                expect.objectContaining({
                    user_id: 'user-1',
                    invariant: 'lot_balance',
                    expected: 4,
                    actual: 5
                })
            )

            // Should also emit the verification alert summary
            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant verification alert.',
                expect.objectContaining({
                    driftCount: 1,
                    alertsRecorded: 1
                })
            )
        })
})
