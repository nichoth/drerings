import {
    afterEach,
    describe,
    expect,
    it,
    vi,
    beforeAll,
    afterAll
} from 'vitest'
import { randomUUID } from 'crypto'

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === '1'

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

    describe.runIf(RUN_INTEGRATION)('integration', () => {
        let fixtureUserId:string

        beforeAll(async () => {
            const { getDatabase } = await import('@netlify/database')
            const pool = getDatabase().pool

            // Create fixture user with stable email based on test session
            const userEmail = `stamps-test-${randomUUID()}@example.com`
            const userResult = await pool.query<{ id: string }>(
                `INSERT INTO users (email, stamps_balance)
                 VALUES ($1, $2)
                 RETURNING id`,
                [userEmail, 0]
            )
            fixtureUserId = userResult.rows[0].id
        })

        afterAll(async () => {
            // CASCADE delete users + all related rows
            const { getDatabase } = await import('@netlify/database')
            const pool = getDatabase().pool
            try {
                await pool.query(
                    'DELETE FROM users WHERE id = $1',
                    [fixtureUserId]
                )
            } catch (_e) {
                // Ignore if already deleted
            }
        })

        it('AC10.3: dedupe via real partial index',
            async () => {
                const { getDatabase } = await import('@netlify/database')
                const pool = getDatabase().pool

                // Corrupt the stamps_balance to trigger drift detection
                await pool.query(
                    `UPDATE users
                     SET stamps_balance = stamps_balance + 1
                     WHERE id = $1`,
                    [fixtureUserId]
                )

                // First verification should detect and record alert
                const { verifyStampInvariants } = await import(
                    '../netlify/lib/stamps'
                )
                const result1 = await verifyStampInvariants()

                // Verify we detected at least one drift
                expect(result1.driftCount).toBeGreaterThanOrEqual(1)
                const relevantDrifts = result1.drifts.filter(
                    d => d.userId === fixtureUserId
                )
                expect(relevantDrifts.length).toBeGreaterThanOrEqual(1)

                // Verify alert was recorded in database
                const alertResult1 = await pool.query<
                    { id: string }
                >(
                    `SELECT id FROM stamp_invariant_alerts
                     WHERE user_id = $1 AND resolved_at IS NULL`,
                    [fixtureUserId]
                )
                expect(alertResult1.rows.length).toBeGreaterThanOrEqual(1)
                const alertId = alertResult1.rows[0].id

                // Second verification should NOT create new alert due to
                // partial index deduplication
                const result2 = await verifyStampInvariants()

                // Same drift still detected (corruption not fixed)
                expect(result2.driftCount).toBeGreaterThanOrEqual(1)

                // But no NEW alert inserted (ON CONFLICT deduped)
                const alertResult2 = await pool.query<{ id: string }>(
                    `SELECT id FROM stamp_invariant_alerts
                     WHERE user_id = $1 AND resolved_at IS NULL`,
                    [fixtureUserId]
                )
                expect(alertResult2.rows).toHaveLength(1)
                expect(alertResult2.rows[0].id).toBe(alertId)
            })

        it('AC10.5: manual resolution allows re-detection',
            async () => {
                const { getDatabase } = await import('@netlify/database')
                const pool = getDatabase().pool

                try {
                    // Corrupt the stamps_balance to trigger drift detection
                    await pool.query(
                        `UPDATE users
                         SET stamps_balance = stamps_balance + 1
                         WHERE id = $1`,
                        [fixtureUserId]
                    )

                    // First verification should detect and record alert
                    const { verifyStampInvariants } = await import(
                        '../netlify/lib/stamps'
                    )
                    const result1 = await verifyStampInvariants()

                    expect(result1.driftCount).toBeGreaterThanOrEqual(1)

                    // Get the alert id
                    const alertResult1 = await pool.query<{ id: string }>(
                        `SELECT id FROM stamp_invariant_alerts
                         WHERE user_id = $1 AND resolved_at IS NULL`,
                        [fixtureUserId]
                    )
                    expect(alertResult1.rows.length).toBeGreaterThanOrEqual(1)
                    const oldAlertId = alertResult1.rows[0].id

                    // Mark the alert as resolved
                    await pool.query(
                        `UPDATE stamp_invariant_alerts
                         SET resolved_at = now()
                         WHERE id = $1`,
                        [oldAlertId]
                    )

                    // Second verification with corruption still present
                    const result2 = await verifyStampInvariants()

                    // Should detect the same drift again
                    expect(result2.driftCount).toBeGreaterThanOrEqual(1)

                    // And create a NEW alert row (old one was marked resolved)
                    const alertResult2 = await pool.query<{ id: string }>(
                        `SELECT id FROM stamp_invariant_alerts
                         WHERE user_id = $1 AND resolved_at IS NULL`,
                        [fixtureUserId]
                    )
                    expect(alertResult2.rows.length).toBeGreaterThanOrEqual(1)
                    const newAlertId = alertResult2.rows[0].id

                    // New alert should be different from old
                    expect(newAlertId).not.toBe(oldAlertId)

                    // Verify old alert is still marked resolved
                    const oldAlert = await pool.query<{ resolved_at: string }>(
                        `SELECT resolved_at FROM stamp_invariant_alerts
                         WHERE id = $1`,
                        [oldAlertId]
                    )
                    expect(oldAlert.rows[0].resolved_at).not.toBeNull()
                } finally {
                    // Clean up corruption
                    await pool.query(
                        `UPDATE users
                         SET stamps_balance = 0
                         WHERE id = $1`,
                        [fixtureUserId]
                    )
                    // Clean up any alerts created by this test
                    await pool.query(
                        `DELETE FROM stamp_invariant_alerts
                         WHERE user_id = $1`,
                        [fixtureUserId]
                    )
                }
            })
    })
})
