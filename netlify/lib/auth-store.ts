import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'

export interface MagicLinkLogin {
    userId:string;
    token:string;
    expiresAt:Date;
}

export interface SessionUser {
    id:string;
    email:string;
    subscription_status:'free'|'active'|'canceled'|'past_due';
}

export async function createMagicLinkLogin (
    email:string
):Promise<MagicLinkLogin> {
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + (15 * 60 * 1000))
    const db = getDatabase()
    const result = await db.pool.query<{ user_id:string }>(`
        WITH selected_user AS (
            INSERT INTO users (email)
            VALUES ($1)
            ON CONFLICT (email)
            DO UPDATE SET email = EXCLUDED.email
            RETURNING id
        )
        INSERT INTO magic_link_tokens (token, user_id, expires_at)
        SELECT $2, id, $3
        FROM selected_user
        RETURNING user_id
    `, [email, token, expiresAt])

    return {
        userId: result.rows[0].user_id,
        token,
        expiresAt
    }
}

export async function consumeMagicLinkToken (
    token:string
):Promise<SessionUser|null> {
    const db = getDatabase()
    const result = await db.pool.query<SessionUser>(`
        UPDATE magic_link_tokens AS magic_link
        SET used_at = now()
        FROM users
        WHERE magic_link.token = $1
            AND magic_link.user_id = users.id
            AND magic_link.used_at IS NULL
            AND magic_link.expires_at > now()
        RETURNING
            users.id,
            users.email,
            users.subscription_status
    `, [token])

    return result.rows[0] || null
}
