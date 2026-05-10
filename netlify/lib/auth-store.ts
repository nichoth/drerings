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
    autumn_customer_id?:string|null;
}

export async function createMagicLinkLogin (
    email:string
):Promise<MagicLinkLogin|null> {
    const db = getDatabase()
    const lookup = await db.pool.query<{
        id:string;
        subscription_status:'free'|'active'|'canceled'|'past_due';
    }>(
        'SELECT id, subscription_status FROM users WHERE email = $1',
        [email]
    )
    const user = lookup.rows[0]

    if (!user || user.subscription_status === 'free') return null

    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + (15 * 60 * 1000))
    const insert = await db.pool.query<{ user_id:string }>(`
        INSERT INTO magic_link_tokens (token, user_id, expires_at, purpose)
        VALUES ($1, $2, $3, 'login')
        RETURNING user_id
    `, [token, user.id, expiresAt])

    return {
        userId: insert.rows[0].user_id,
        token,
        expiresAt
    }
}

export async function upsertCheckoutUser (
    email:string
):Promise<SessionUser> {
    const db = getDatabase()
    const result = await db.pool.query<SessionUser>(`
        INSERT INTO users (email)
        VALUES ($1)
        ON CONFLICT (email)
        DO UPDATE SET email = EXCLUDED.email
        RETURNING
            id,
            email,
            subscription_status,
            autumn_customer_id
    `, [email])

    return result.rows[0]
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
            AND magic_link.purpose = 'login'
            AND magic_link.used_at IS NULL
            AND magic_link.expires_at > now()
        RETURNING
            users.id,
            users.email,
            users.subscription_status
    `, [token])

    return result.rows[0] || null
}
