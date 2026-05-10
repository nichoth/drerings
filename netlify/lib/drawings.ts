import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import {
    deleteDrawingImage,
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

function timestampString (value:string|Date):string {
    if (value instanceof Date) return value.toISOString()

    return value
}
