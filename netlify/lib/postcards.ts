import { getDatabase } from '@netlify/database'
import {
    refundFailedSend,
    type DatabaseClient,
    type QueryResult
} from './stamps.js'

export type CreatePostcardInput = {
    senderId:string;
    drawingId:string;
    recipientEmail:string;
    lotId:string|null;
    idempotencyKey:string|null;
}

// snake_case matches sibling row types (posts.ts, stamps.ts)
export type PostcardRow = {
    id:string;
    sender_id:string;
    drawing_id:string;
    recipient_email:string;
    lot_id:string|null;
    resend_email_id:string|null;
    status:'queued'|'sent'|'failed_refunded';
    idempotency_key:string|null;
    created_at:string;
}

export async function findOrCreateQueuedPostcard (
    input:CreatePostcardInput
):Promise<{ postcard:PostcardRow; reused:boolean }> {
    const db = getDatabase()

    if (!input.idempotencyKey) {
        // No idempotency key - plain INSERT without conflict
        const result = await db.pool.query<PostcardRow>(`
            INSERT INTO postcards (
                sender_id,
                drawing_id,
                recipient_email,
                lot_id,
                idempotency_key,
                status
            )
            VALUES ($1, $2, $3, $4, $5, 'queued')
            RETURNING *
        `, [
            input.senderId,
            input.drawingId,
            input.recipientEmail,
            input.lotId,
            input.idempotencyKey
        ])

        return { postcard: result.rows[0], reused: false }
    }

    // With idempotency key - use ON CONFLICT for atomicity
    // The harmless SET in DO UPDATE forces RETURNING to fire on the
    // existing row when there's a conflict (ON CONFLICT DO NOTHING with
    // RETURNING returns no row on conflict).
    const result = await db.pool.query<
        PostcardRow & {reused:boolean}
    >(`
        INSERT INTO postcards (
            sender_id,
            drawing_id,
            recipient_email,
            lot_id,
            idempotency_key,
            status
        )
        VALUES ($1, $2, $3, $4, $5, 'queued')
        ON CONFLICT (sender_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO UPDATE SET sender_id = EXCLUDED.sender_id
        RETURNING *, (xmax <> 0) AS reused
    `, [
        input.senderId,
        input.drawingId,
        input.recipientEmail,
        input.lotId,
        input.idempotencyKey
    ])

    const row = result.rows[0]
    const reused = row.reused === true

    return { postcard: row, reused }
}

export async function attachLotAndMarkSent (
    postcardId:string,
    lotId:string,
    resendEmailId:string
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        UPDATE postcards
        SET lot_id = $1,
            resend_email_id = $2,
            status = 'sent',
            updated_at = now()
        WHERE id = $3
    `, [lotId, resendEmailId, postcardId])
}

export async function markFailedRefunded (
    postcardId:string
):Promise<void> {
    const db = getDatabase()

    // Accept 'queued' too: the sync failure path (Phase 1) catches
    // before attachLotAndMarkSent runs, so the row is still 'queued'.
    // Only the async bounce path (Phase 2) sees the row as 'sent'.
    await db.pool.query(`
        UPDATE postcards
        SET status = 'failed_refunded',
            updated_at = now()
        WHERE id = $1 AND status IN ('sent', 'queued')
    `, [postcardId])
}

export async function getPostcardByResendEmailId (
    resendEmailId:string
):Promise<PostcardRow|null> {
    const db = getDatabase()
    const result = await db.pool.query<PostcardRow>(`
        SELECT *
        FROM postcards
        WHERE resend_email_id = $1
    `, [resendEmailId])

    return result.rows[0] || null
}

export async function deleteIfQueued (
    postcardId:string
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        DELETE FROM postcards
        WHERE id = $1 AND status = 'queued'
    `, [postcardId])
}

export type RefundPostcardBounceResult =
    | { refunded:true; balanceAfter:number }
    | { refunded:false; reason:'already_refunded'|'not_sent' }

/**
 * Atomic CAS + refund for the Resend bounce webhook path.
 *
 * Runs one transaction:
 *   1. UPDATE postcards SET status='failed_refunded'
 *        WHERE id=$1 AND status='sent' RETURNING sender_id, lot_id
 *   2. If zero rows: ROLLBACK, return { refunded:false, reason }
 *   3. Else: refundFailedSend({ ..., client }), COMMIT
 *
 * Idempotent under Svix retries — the CAS atomically claims the
 * "sent → failed_refunded" transition. Concurrent attempts have
 * exactly one winner.
 */
export async function refundPostcardBounce (
    postcardId:string
):Promise<RefundPostcardBounceResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        // resend_email_id and status='sent' are written atomically by
        // attachLotAndMarkSent — finding the postcard by resend_email_id
        // implies status='sent'. The 'debiting' allowance is forward-compat
        // with Phase 4 in case future state-machine changes ever allow
        // resend_email_id to be set during 'debiting'.
        const updated = await client.query<{
            sender_id:string;
            lot_id:string|null;
        }>(`
            UPDATE postcards
            SET status = 'failed_refunded',
                updated_at = now()
            WHERE id = $1
                AND status IN ('sent', 'debiting')
                AND lot_id IS NOT NULL
            RETURNING sender_id, lot_id
        `, [postcardId])

        if (!updated.rows[0]) {
            await client.query('ROLLBACK')
            return classifyMissedRefund(postcardId, db.pool)
        }

        const { sender_id: senderId, lot_id: lotId } = updated.rows[0]

        if (!lotId) {
            // Defensive: WHERE clause already guarded against null lot_id,
            // but TypeScript can't prove it.
            await client.query('ROLLBACK')
            return { refunded: false, reason: 'not_sent' }
        }

        const { balanceAfter } = await refundFailedSend({
            userId: senderId,
            lotId,
            client
        })

        await client.query('COMMIT')

        return { refunded: true, balanceAfter }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
    } finally {
        client.release()
    }
}

async function classifyMissedRefund (
    postcardId:string,
    pool:{
        query:<Row = Record<string, unknown>>(
            sql:string,
            params?:unknown[]
        ) => Promise<QueryResult<Row>>
    }
):Promise<RefundPostcardBounceResult> {
    const result = await pool.query<{ status:string }>(
        'SELECT status FROM postcards WHERE id = $1',
        [postcardId]
    )
    const status = result.rows[0]?.status

    if (status === 'failed_refunded') {
        return { refunded: false, reason: 'already_refunded' }
    }
    return { refunded: false, reason: 'not_sent' }
}
