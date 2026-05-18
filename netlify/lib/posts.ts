import { getDatabase } from '@netlify/database'
import { getDrawingImage } from './drawing-images.js'

export interface PublicPost {
    id:number;
}

export interface PublicPostDetails extends PublicPost {
    drawing_id:string;
    image:string;
    text:string;
    alt_text:string;
    published_at:string;
}

interface PublicPostRow {
    id:number|string;
}

interface PublicPostDetailsRow {
    id:number|string;
    drawing_id:string;
    blob_key:string;
    text:string;
    alt_text:string;
    published_at:string|Date;
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

export async function userOwnsDrawing (
    userId:string,
    drawingId:string
):Promise<boolean> {
    const db = getDatabase()
    const result = await db.pool.query(`
        SELECT 1
        FROM drawings
        WHERE id = $1
            AND user_id = $2
        LIMIT 1
    `, [drawingId, userId])

    return Boolean(result.rows[0])
}

export async function getPublishedPost (
    postId:number
):Promise<PublicPostDetails|null> {
    const db = getDatabase()
    const result = await db.pool.query<PublicPostDetailsRow>(`
        SELECT
            public_posts.id,
            drawings.id AS drawing_id,
            drawings.blob_key,
            drawings.text,
            drawings.alt_text,
            public_posts.published_at
        FROM public_posts
        JOIN drawings
            ON drawings.id = public_posts.drawing_id
        WHERE public_posts.id = $1
    `, [postId])
    const row = result.rows[0]

    if (!row) return null

    const image = await getDrawingImage(row.blob_key)

    return {
        id: Number(row.id),
        drawing_id: row.drawing_id,
        image: await imageDataUrl(image),
        text: row.text,
        alt_text: row.alt_text,
        published_at: timestampString(row.published_at)
    }
}

async function imageDataUrl (image:ArrayBuffer|Blob|null):Promise<string> {
    if (!image) return ''

    if (image instanceof Blob) {
        return 'data:image/png;base64,' +
            Buffer.from(await image.arrayBuffer()).toString('base64')
    }

    return 'data:image/png;base64,' +
        Buffer.from(image).toString('base64')
}

function timestampString (value:string|Date):string {
    if (value instanceof Date) return value.toISOString()

    return value
}
