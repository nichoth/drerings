import { getDatabase } from '@netlify/database'
import { debitStamp } from './stamps.js'

interface QueryResult<Row> {
    rows:Row[];
}

interface DatabaseClient {
    query:<Row = Record<string, unknown>>(
        sql:string,
        params?:unknown[]
    ) => Promise<QueryResult<Row>>;
    release:() => void;
}

// Pure helpers for timezone and month_key derivation.

export function isValidIanaTimezone(tz:string):boolean {
    if (typeof tz !== 'string' || tz.length === 0) return false

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

export function monthKeyFor(
    timezone:string,
    instant:Date = new Date()
):string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(instant)

    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value

    if (!year || !month) {
        throw new Error(`Failed to derive month key for tz=${timezone}`)
    }

    return `${year}-${month}`
}

// Result types for precheck and confirm flows.

export type PrecheckResult =
    | { type:'free'; month_key:string }
    | { type:'paid'; stamps_balance:number; month_key:string }
    | {
        type:'blocked';
        reason:'no_free_no_stamps';
        stamps_balance:0;
        month_key:string;
    }
    | { type:'reused'; was_free:boolean }

export type ConfirmResult =
    | { type:'recorded'; was_free:boolean; stamps_balance:number }
    | { type:'blocked'; reason:'no_free_no_stamps' }

export interface PrecheckOptions {
    userId:string;
    drawingId:string;
    timezone:string;
    idempotencyKey:string;
}

export interface ConfirmOptions extends PrecheckOptions {}

export class IdempotencyConflictError extends Error {
    constructor() {
        super('idempotency_key already used for a different drawing_id')
    }
}

// Task 4: Read-only precheck - determine share eligibility.

export async function precheckShare(
    options:PrecheckOptions
):Promise<PrecheckResult> {
    const db = getDatabase()
    const monthKey = monthKeyFor(options.timezone)

    // Check for existing event under this idempotency_key.
    // If found with matching drawing_id, return reused.
    // If found with different drawing_id, throw conflict error.
    const existing = await db.pool.query<{
        drawing_id:string;
        was_free:boolean;
    }>(`
        SELECT drawing_id, was_free
        FROM share_events
        WHERE user_id = $1 AND idempotency_key = $2
    `, [options.userId, options.idempotencyKey])

    if (existing.rows[0]) {
        if (existing.rows[0].drawing_id !== options.drawingId) {
            throw new IdempotencyConflictError()
        }
        return {
            type: 'reused',
            was_free: existing.rows[0].was_free
        }
    }

    // Check if user has used their free share this month.
    const freeUsed = await db.pool.query<{ count:string }>(`
        SELECT count(*)::text AS count
        FROM share_events
        WHERE user_id = $1
            AND month_key = $2
            AND was_free = true
    `, [options.userId, monthKey])

    const freeUsedCount = parseInt(freeUsed.rows[0]?.count ?? '0', 10)

    if (freeUsedCount === 0) {
        return { type: 'free', month_key: monthKey }
    }

    // Free share used; check balance for paid option.
    const balanceRow = await db.pool.query<{ stamps_balance:number }>(
        'SELECT stamps_balance FROM users WHERE id = $1',
        [options.userId]
    )
    const balance = Number(balanceRow.rows[0]?.stamps_balance ?? 0)

    if (balance > 0) {
        return {
            type: 'paid',
            stamps_balance: balance,
            month_key: monthKey
        }
    }

    return {
        type: 'blocked',
        reason: 'no_free_no_stamps',
        stamps_balance: 0,
        month_key: monthKey
    }
}

// Single-transaction confirm: record share with serialization via
// SELECT ... FOR UPDATE.

export async function recordShare(
    options:ConfirmOptions
):Promise<ConfirmResult> {
    const db = getDatabase()
    const monthKey = monthKeyFor(options.timezone)
    const client = await db.pool.connect() as DatabaseClient

    try {
        // Early dup-check uses pool.query (no tx needed).
        // We do it BEFORE BEGIN so we don't need to manage transaction
        // state for the throw path.
        const earlyDup = await db.pool.query<{
            drawing_id:string;
            was_free:boolean;
        }>(`
            SELECT drawing_id, was_free
            FROM share_events
            WHERE user_id = $1 AND idempotency_key = $2
        `, [options.userId, options.idempotencyKey])

        if (earlyDup.rows[0]) {
            if (earlyDup.rows[0].drawing_id !== options.drawingId) {
                throw new IdempotencyConflictError()
            }
            const balanceRow = await db.pool.query<{
                stamps_balance:number;
            }>(
                'SELECT stamps_balance FROM users WHERE id = $1',
                [options.userId]
            )
            return {
                type: 'recorded',
                was_free: earlyDup.rows[0].was_free,
                stamps_balance: Number(
                    balanceRow.rows[0]?.stamps_balance ?? 0
                )
            }
        }

        await client.query('BEGIN')

        // Serialize concurrent confirms on the same user.
        await client.query(
            'SELECT id FROM users WHERE id = $1 FOR UPDATE',
            [options.userId]
        )

        // Re-check the free count under the lock.
        const freeCheck = await client.query<{ count:string }>(`
            SELECT count(*)::text AS count
            FROM share_events
            WHERE user_id = $1
                AND month_key = $2
                AND was_free = true
        `, [options.userId, monthKey])

        const freeUsedCount = parseInt(
            freeCheck.rows[0]?.count ?? '0',
            10
        )

        if (freeUsedCount === 0) {
            // Free path: insert share_events with was_free=true.
            await client.query(`
                INSERT INTO share_events
                    (user_id, drawing_id, month_key, timezone,
                     was_free, idempotency_key)
                VALUES ($1, $2, $3, $4, true, $5)
            `, [
                options.userId,
                options.drawingId,
                monthKey,
                options.timezone,
                options.idempotencyKey
            ])

            const balanceRow = await client.query<{
                stamps_balance:number;
            }>(
                'SELECT stamps_balance FROM users WHERE id = $1',
                [options.userId]
            )

            await client.query('COMMIT')

            return {
                type: 'recorded',
                was_free: true,
                stamps_balance: Number(
                    balanceRow.rows[0]?.stamps_balance ?? 0
                )
            }
        }

        // Paid path: check balance under the same lock.
        const balanceRow = await client.query<{
            stamps_balance:number;
        }>(
            'SELECT stamps_balance FROM users WHERE id = $1',
            [options.userId]
        )
        const balance = Number(
            balanceRow.rows[0]?.stamps_balance ?? 0
        )

        if (balance <= 0) {
            await client.query('ROLLBACK')
            return {
                type: 'blocked',
                reason: 'no_free_no_stamps'
            }
        }

        // Insert paid share event AND debit a stamp inside the
        // same transaction. debitStamp runs on the supplied client
        // (it does NOT BEGIN/COMMIT/release).
        const insert = await client.query<{ id:string }>(`
            INSERT INTO share_events
                (user_id, drawing_id, month_key, timezone,
                 was_free, idempotency_key)
            VALUES ($1, $2, $3, $4, false, $5)
            RETURNING id
        `, [
            options.userId,
            options.drawingId,
            monthKey,
            options.timezone,
            options.idempotencyKey
        ])

        const debitResult = await debitStamp({
            userId: options.userId,
            referenceId: insert.rows[0].id,
            reason: 'share',
            client  // <-- share the transaction
        })

        await client.query('COMMIT')

        return {
            type: 'recorded',
            was_free: false,
            stamps_balance: debitResult.balanceAfter
        }
    } catch (err) {
        // ROLLBACK best-effort. If we never BEGAN (the early-dup
        // path), this is a harmless no-op.
        try {
            await client.query('ROLLBACK')
        } catch {
            // ignore
        }
        // Map UNIQUE-constraint violation on (user_id, idempotency_key)
        // to IdempotencyConflictError so callers get a consistent
        // 409 mapping.
        if (isUniqueViolation(err)) {
            throw new IdempotencyConflictError()
        }
        throw err
    } finally {
        client.release()
    }
}

function isUniqueViolation(err:unknown):boolean {
    // Postgres error code 23505: unique_violation.
    return !!err
        && typeof err === 'object'
        && (err as { code?:string }).code === '23505'
}
