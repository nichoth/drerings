import { getDatabase } from '@netlify/database'

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
    const result = await db.pool.query<
        PostcardRow & {xmax:string}
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
        RETURNING *, (xmax::text != '0') AS reused
    `, [
        input.senderId,
        input.drawingId,
        input.recipientEmail,
        input.lotId,
        input.idempotencyKey
    ])

    const row = result.rows[0]
    const reused = row.xmax !== '0'

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

    await db.pool.query(`
        UPDATE postcards
        SET status = 'failed_refunded',
            updated_at = now()
        WHERE id = $1
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
