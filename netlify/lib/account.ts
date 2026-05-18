import { getDatabase } from '@netlify/database'
import type { SessionUser } from './auth-store.js'
import { deleteDrawingImage } from './drawing-images.js'

export interface AccountPasskey {
    id:string;
    created_at:string;
}

export interface AccountDetails extends SessionUser {
    passkeys:AccountPasskey[];
}

interface DrawingBlobRow {
    blob_key:string;
}

export async function getAccountDetails (
    userId:string
):Promise<AccountDetails|null> {
    void userId
    // TODO(phase-4): rewrite for DID-keyed users after auth revival.
    return null
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
        DELETE FROM users
        WHERE id = $1
    `, [userId])

    await Promise.all(drawings.rows.map((drawing) => {
        return deleteDrawingImage(drawing.blob_key)
    }))
}

