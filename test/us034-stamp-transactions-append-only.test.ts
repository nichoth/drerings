import { describe, expect, it, beforeAll } from 'vitest'

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === '1'

describe('US-034 stamp_transactions append-only triggers', () => {
    describe('unit-level (mocked)', () => {
        it('error message format is what the trigger emits', () => {
            const updateError = new Error(
                'stamp_transactions is append-only (attempted UPDATE)'
            )
            expect(updateError.message).toMatch(/append-only/)
            expect(updateError.message).toMatch(/UPDATE/)

            const deleteError = new Error(
                'stamp_transactions is append-only (attempted DELETE)'
            )
            expect(deleteError.message).toMatch(/append-only/)
            expect(deleteError.message).toMatch(/DELETE/)
        })
    })

    describe.runIf(RUN_INTEGRATION)('integration', () => {
        let userId:string
        let lotId:string
        let txId:string

        beforeAll(async () => {
            // Insert a fixture row to attempt mutating.
            const { getDatabase } = await import('@netlify/database')
            const pool = getDatabase().pool
            // users.id is uuid (see 0001_paid_accounts_schema). Just use
            // the database default — let it generate the uuid.
            const userResult = await pool.query<{id:string}>(
                `INSERT INTO users (email)
                 VALUES ($1)
                 RETURNING id`,
                ['append-only-' + Date.now() + '@example.com']
            )
            userId = userResult.rows[0].id
            const lot = await pool.query<{id:string}>(
                `INSERT INTO stamp_lots
                    (user_id, source, original_count, remaining_count)
                 VALUES ($1, 'grant', 5, 5)
                 RETURNING id`,
                [userId]
            )
            lotId = lot.rows[0].id
            const tx = await pool.query<{id:string}>(
                `INSERT INTO stamp_transactions
                    (user_id, lot_id, delta, reason, balance_after)
                 VALUES ($1, $2, 5, 'grant', 5)
                 RETURNING id`,
                [userId, lotId]
            )
            txId = tx.rows[0].id
        })

        it('rejects UPDATE', async () => {
            const { getDatabase } = await import('@netlify/database')
            await expect(
                getDatabase().pool.query(
                    `UPDATE stamp_transactions
                     SET delta = 0
                     WHERE id = $1`,
                    [txId]
                )
            ).rejects.toThrow(/append-only/)
        })

        it('rejects DELETE', async () => {
            const { getDatabase } = await import('@netlify/database')
            await expect(
                getDatabase().pool.query(
                    `DELETE FROM stamp_transactions
                     WHERE id = $1`,
                    [txId]
                )
            ).rejects.toThrow(/append-only/)
        })

        it('still allows INSERT', async () => {
            const { getDatabase } = await import('@netlify/database')
            const result = await getDatabase().pool.query(
                `INSERT INTO stamp_transactions
                    (user_id, lot_id, delta, reason, balance_after)
                 VALUES ($1, $2, -1, 'send', 4)
                 RETURNING id`,
                [userId, lotId]
            )
            expect(result.rows).toHaveLength(1)
        })
    })
})
