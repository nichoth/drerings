import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import { creditStampLot } from './stamps.js'

export interface MagicLinkLogin {
    userId:string;
    token:string;
    expiresAt:Date;
}

export interface SessionUser {
    id:string;
    email:string;
    stamps_balance?:number;
    autumn_customer_id?:string|null;
}

interface CheckoutUserRow extends SessionUser {
    was_inserted:boolean;
}

interface PendingSignupGiftRow {
    id:string;
    sender_user_id:string;
    count:number|string;
    price_cents:number|string;
    autumn_checkout_id:string;
}

const SIGNUP_GRANT_STAMPS = 5

export async function createMagicLinkLogin (
    email:string
):Promise<MagicLinkLogin|null> {
    const db = getDatabase()
    const lookup = await db.pool.query<{
        id:string;
    }>(
        'SELECT id FROM users WHERE email = $1',
        [email]
    )
    const user = lookup.rows[0]

    if (!user) return null

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
    const result = await db.pool.query<CheckoutUserRow>(`
        WITH inserted_user AS (
            INSERT INTO users (email)
            VALUES ($1)
            ON CONFLICT (email) DO NOTHING
            RETURNING
                id,
                email,
                autumn_customer_id,
                stamps_balance,
                true AS was_inserted
        )
        SELECT
            id,
            email,
            autumn_customer_id,
            stamps_balance,
            was_inserted
        FROM inserted_user
        UNION ALL
        SELECT
            users.id,
            users.email,
            users.autumn_customer_id,
            users.stamps_balance,
            false AS was_inserted
        FROM users
        WHERE users.email = $1
            AND NOT EXISTS (SELECT 1 FROM inserted_user)
    `, [email])
    const user = result.rows[0]

    if (user.was_inserted) {
        const grant = await creditStampLot({
            userId: user.id,
            source: 'grant',
            count: SIGNUP_GRANT_STAMPS,
            priceCents: null
        })
        const balanceAfterGifts = await claimPendingSignupGifts(
            user.id,
            user.email,
            grant.balanceAfter
        )

        return { ...user, stamps_balance: balanceAfterGifts }
    }

    return user
}

async function claimPendingSignupGifts (
    userId:string,
    email:string,
    startingBalance:number
):Promise<number> {
    const db = getDatabase()
    const result = await db.pool.query<PendingSignupGiftRow>(`
        SELECT
            id,
            sender_user_id,
            count,
            price_cents,
            autumn_checkout_id
        FROM pending_gifts
        WHERE recipient_email = $1
            AND status = 'pending'
        ORDER BY created_at ASC
    `, [email])
    let balanceAfter = startingBalance

    for (const gift of result.rows) {
        const credit = await creditStampLot({
            userId,
            source: 'gift_received',
            count: Number(gift.count),
            priceCents: Number(gift.price_cents),
            autumnCheckoutId: gift.autumn_checkout_id,
            giftedByUserId: gift.sender_user_id
        })

        balanceAfter = credit.balanceAfter

        await db.pool.query(`
            UPDATE pending_gifts
            SET status = 'claimed'
            WHERE id = $1
                AND status = 'pending'
        `, [gift.id])
    }

    return balanceAfter
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
            users.email
    `, [token])

    return result.rows[0] || null
}
