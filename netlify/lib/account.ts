import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import type { SessionUser } from './auth-store.js'
import { deleteDrawingImage } from './drawing-images.js'
import { sendMagicLinkEmail } from './resend.js'

export interface AccountPasskey {
    id:string;
    created_at:string;
}

export interface AccountDetails extends SessionUser {
    subscription_current_period_end:string|null;
    passkeys:AccountPasskey[];
}

interface UserAccountRow {
    id:string;
    email:string;
    subscription_status:SessionUser['subscription_status'];
    subscription_current_period_end:string|Date|null;
}

interface PasskeyRow {
    id:string;
    created_at:string|Date;
}

interface DrawingBlobRow {
    blob_key:string;
}

export async function getAccountDetails (
    userId:string
):Promise<AccountDetails|null> {
    const db = getDatabase()
    const userResult = await db.pool.query<UserAccountRow>(`
        SELECT
            id,
            email,
            subscription_status,
            subscription_current_period_end
        FROM users
        WHERE id = $1
    `, [userId])
    const user = userResult.rows[0]

    if (!user) return null

    const passkeyResult = await db.pool.query<PasskeyRow>(`
        SELECT id, created_at
        FROM passkeys
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [userId])

    return {
        id: user.id,
        email: user.email,
        subscription_status: user.subscription_status,
        subscription_current_period_end: nullableDateString(
            user.subscription_current_period_end
        ),
        passkeys: passkeyResult.rows.map((passkey) => {
            return {
                id: passkey.id,
                created_at: dateString(passkey.created_at)
            }
        })
    }
}

export async function requestEmailUpdate (
    userId:string,
    email:string,
    origin:string
):Promise<void> {
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + (15 * 60 * 1000))
    const db = getDatabase()

    await db.pool.query(`
        INSERT INTO magic_link_tokens (
            token,
            user_id,
            expires_at,
            purpose,
            pending_email
        )
        VALUES ($1, $2, $3, 'email_update', $4)
    `, [token, userId, expiresAt, email])

    const url = new URL('/api/account/email/callback', origin)

    url.searchParams.set('token', token)

    await sendMagicLinkEmail({
        email,
        loginUrl: url.toString()
    })
}

export async function confirmEmailUpdate (
    token:string
):Promise<SessionUser|null> {
    const db = getDatabase()
    const result = await db.pool.query<SessionUser>(`
        WITH consumed AS (
            UPDATE magic_link_tokens
            SET used_at = now()
            WHERE token = $1
                AND purpose = 'email_update'
                AND pending_email IS NOT NULL
                AND used_at IS NULL
                AND expires_at > now()
            RETURNING user_id, pending_email
        )
        UPDATE users
        SET email = consumed.pending_email
        FROM consumed
        WHERE users.id = consumed.user_id
        RETURNING
            users.id,
            users.email,
            users.subscription_status
    `, [token])

    return result.rows[0] || null
}

export async function removePasskey (
    userId:string,
    passkeyId:string
):Promise<boolean> {
    const db = getDatabase()
    const result = await db.pool.query(`
        DELETE FROM passkeys
        WHERE id = $1
            AND user_id = $2
    `, [passkeyId, userId])

    return result.rowCount === 1
}

export async function deleteAccountData (userId:string):Promise<void> {
    const db = getDatabase()
    const drawings = await db.pool.query<DrawingBlobRow>(`
        SELECT blob_key
        FROM drawings
        WHERE user_id = $1
    `, [userId])

    await db.pool.query(`
        DELETE FROM public_posts
        WHERE drawing_id IN (
            SELECT id
            FROM drawings
            WHERE user_id = $1
        )
    `, [userId])
    await db.pool.query(`
        DELETE FROM drawings
        WHERE user_id = $1
    `, [userId])
    await db.pool.query(`
        DELETE FROM passkeys
        WHERE user_id = $1
    `, [userId])
    await db.pool.query(`
        DELETE FROM magic_link_tokens
        WHERE user_id = $1
    `, [userId])
    await db.pool.query(`
        DELETE FROM users
        WHERE id = $1
    `, [userId])

    await Promise.all(drawings.rows.map((drawing) => {
        return deleteDrawingImage(drawing.blob_key)
    }))
}

function nullableDateString (value:string|Date|null):string|null {
    if (!value) return null

    return dateString(value).slice(0, 10)
}

function dateString (value:string|Date):string {
    if (value instanceof Date) return value.toISOString()

    return value
}
