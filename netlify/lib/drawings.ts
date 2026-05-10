import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import {
    deleteDrawingImage,
    getDrawingImage,
    putDrawingImage
} from './drawing-images.js'

export interface SavedDrawingInput {
    image:string;
    text:string;
    alt_text:string;
}

export interface CreatedDrawing {
    id:string;
    created_at:string;
}

export interface UpdatedDrawing {
    id:string;
    updated_at:string;
}

export interface SavedDrawing {
    id:string;
    image:string;
    text:string;
    alt_text:string;
    updated_at:string;
}

interface DrawingInsertRow {
    id:string;
    created_at:string|Date;
}

interface DrawingUpdateRow {
    id:string;
    updated_at:string|Date;
}

interface ExistingDrawingRow {
    blob_key:string;
}

interface SavedDrawingRow {
    id:string;
    blob_key:string;
    text:string;
    alt_text:string;
    updated_at:string|Date;
}

export async function createSavedDrawing (
    userId:string,
    input:SavedDrawingInput
):Promise<CreatedDrawing> {
    const drawingId = crypto.randomUUID()
    const image = imageBlobFromBase64(input.image)
    const blobKey = await putDrawingImage(userId, drawingId, image)
    const db = getDatabase()
    const result = await db.pool.query<DrawingInsertRow>(`
        INSERT INTO drawings (id, user_id, blob_key, text, alt_text)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at
    `, [
        drawingId,
        userId,
        blobKey,
        input.text,
        input.alt_text
    ])
    const row = result.rows[0]

    if (!row) throw new Error('Drawing insert did not return a row')

    return {
        id: row.id,
        created_at: timestampString(row.created_at)
    }
}

export async function updateSavedDrawing (
    userId:string,
    drawingId:string,
    input:SavedDrawingInput
):Promise<UpdatedDrawing|null> {
    const db = getDatabase()
    const current = await db.pool.query<ExistingDrawingRow>(`
        SELECT blob_key
        FROM drawings
        WHERE id = $1
            AND user_id = $2
    `, [drawingId, userId])
    const previousBlobKey = current.rows[0]?.blob_key

    if (!previousBlobKey) return null

    const image = imageBlobFromBase64(input.image)
    const blobKey = await putDrawingImage(userId, drawingId, image)
    const result = await db.pool.query<DrawingUpdateRow>(`
        UPDATE drawings
        SET
            blob_key = $3,
            text = $4,
            alt_text = $5,
            updated_at = now()
        WHERE id = $1
            AND user_id = $2
        RETURNING id, updated_at
    `, [
        drawingId,
        userId,
        blobKey,
        input.text,
        input.alt_text
    ])
    const row = result.rows[0]

    if (!row) return null

    if (previousBlobKey !== blobKey) {
        await deleteDrawingImage(previousBlobKey)
    }

    return {
        id: row.id,
        updated_at: timestampString(row.updated_at)
    }
}

export async function listSavedDrawings (
    userId:string
):Promise<SavedDrawing[]> {
    const db = getDatabase()
    const result = await db.pool.query<SavedDrawingRow>(`
        SELECT id, blob_key, text, alt_text, updated_at
        FROM drawings
        WHERE user_id = $1
        ORDER BY updated_at DESC
    `, [userId])

    return Promise.all(result.rows.map(drawingFromRow))
}

export async function getSavedDrawing (
    userId:string,
    drawingId:string
):Promise<SavedDrawing|null> {
    const db = getDatabase()
    const result = await db.pool.query<SavedDrawingRow>(`
        SELECT id, blob_key, text, alt_text, updated_at
        FROM drawings
        WHERE id = $1
            AND user_id = $2
    `, [drawingId, userId])
    const row = result.rows[0]

    if (!row) return null

    return drawingFromRow(row)
}

export async function deleteSavedDrawing (
    userId:string,
    drawingId:string
):Promise<boolean> {
    const db = getDatabase()
    const current = await db.pool.query<ExistingDrawingRow>(`
        SELECT blob_key
        FROM drawings
        WHERE id = $1
            AND user_id = $2
    `, [drawingId, userId])
    const blobKey = current.rows[0]?.blob_key

    if (!blobKey) return false

    await db.pool.query(`
        DELETE FROM public_posts
        WHERE drawing_id = $1
    `, [drawingId])
    const result = await db.pool.query(`
        DELETE FROM drawings
        WHERE id = $1
            AND user_id = $2
    `, [drawingId, userId])

    if (result.rowCount === 0) return false

    await deleteDrawingImage(blobKey)

    return true
}

function imageBlobFromBase64 (value:string):Blob {
    const dataUrl = value.match(/^data:([^;,]+);base64,(.+)$/)
    const type = dataUrl?.[1] || 'image/png'
    const encoded = dataUrl?.[2] || value
    const bytes = Buffer.from(encoded, 'base64')

    if (bytes.length === 0) {
        throw new Error('Drawing image is empty')
    }

    return new Blob([bytes], { type })
}

async function drawingFromRow (row:SavedDrawingRow):Promise<SavedDrawing> {
    const image = await getDrawingImage(row.blob_key)

    return {
        id: row.id,
        image: await imageDataUrl(image),
        text: row.text,
        alt_text: row.alt_text,
        updated_at: timestampString(row.updated_at)
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
