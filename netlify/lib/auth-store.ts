import { getDatabase } from '@netlify/database'
import { creditStampLot } from './stamps.js'

export interface SessionUser {
    id:string;
    did:string;
    handle:string;
    stamps_balance?:number;
    autumn_customer_id?:string|null;
}

const SIGNUP_GRANT_STAMPS = 5

export async function upsertOAuthUser (
    did:string,
    handle:string
):Promise<{ user:SessionUser; wasInserted:boolean }> {
    const db = getDatabase()
    const result = await db.pool.query<{
        id:string;
        did:string;
        handle:string;
        stamps_balance:number;
        autumn_customer_id:string|null;
        was_inserted:boolean;
    }>(`
        INSERT INTO users (did, handle, handle_updated_at,
                           stamps_balance)
        VALUES ($1, $2, now(), 0)
        ON CONFLICT (did) DO UPDATE
            SET handle = EXCLUDED.handle,
                handle_updated_at = now()
        RETURNING id, did, handle, stamps_balance,
                  autumn_customer_id,
                  (xmax = 0) AS was_inserted
    `, [did, handle])

    const row = result.rows[0]
    const wasInserted = row.was_inserted

    if (wasInserted) {
        // Signup grant
        await creditStampLot({
            userId: row.id,
            source: 'grant',
            count: SIGNUP_GRANT_STAMPS,
            priceCents: 0
        })

        // Refresh balance after the grant
        const after = await db.pool.query<{ stamps_balance:number }>(
            'SELECT stamps_balance FROM users WHERE id = $1',
            [row.id]
        )

        return {
            user: {
                id: row.id,
                did: row.did,
                handle: row.handle,
                stamps_balance: after.rows[0].stamps_balance,
                autumn_customer_id: row.autumn_customer_id
            },
            wasInserted: true
        }
    }

    return {
        user: {
            id: row.id,
            did: row.did,
            handle: row.handle,
            stamps_balance: row.stamps_balance,
            autumn_customer_id: row.autumn_customer_id
        },
        wasInserted: false
    }
}
