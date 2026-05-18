import { getDatabase } from '@netlify/database'
import { deleteDrawingImage } from './drawing-images.js'

export interface AccountDetails {
    id:string;
    did:string;
    handle:string;
    stamps_balance?:number;
    autumn_customer_id?:string|null;
}

interface DrawingBlobRow {
    blob_key:string;
}

export async function getAccountDetails (
    userId:string
):Promise<AccountDetails|null> {
    const db = getDatabase()
    const result = await db.pool.query<AccountDetails>(`
        SELECT id, did, handle, stamps_balance, autumn_customer_id
        FROM users
        WHERE id = $1
    `, [userId])

    return result.rows[0] || null
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

