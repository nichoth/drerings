import { getDatabase } from '@netlify/database'

export interface PublicPost {
    id:number;
}

interface PublicPostRow {
    id:number|string;
}

export async function publishDrawing (
    userId:string,
    drawingId:string
):Promise<PublicPost|null> {
    const db = getDatabase()
    const result = await db.pool.query<PublicPostRow>(`
        WITH owned_drawing AS (
            SELECT id
            FROM drawings
            WHERE id = $1
                AND user_id = $2
        ),
        upserted_post AS (
            INSERT INTO public_posts (drawing_id)
            SELECT id
            FROM owned_drawing
            ON CONFLICT (drawing_id) DO UPDATE
            SET drawing_id = EXCLUDED.drawing_id
            RETURNING id
        )
        SELECT id
        FROM upserted_post
    `, [drawingId, userId])
    const row = result.rows[0]

    if (!row) return null

    return { id: Number(row.id) }
}
