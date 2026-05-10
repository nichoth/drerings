import { beforeEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const putDrawingImage = vi.fn()
const deleteDrawingImage = vi.fn()

vi.mock('../netlify/lib/drawing-images', () => {
    return {
        putDrawingImage,
        deleteDrawingImage
    }
})

describe('US-008 drawing persistence helpers', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('stores a new drawing image and inserts the drawing row', async () => {
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'drawing-1',
                    created_at: '2026-05-10T12:00:00.000Z'
                }]
            }
        })

        putDrawingImage.mockResolvedValue(
            'users/user-1/drawings/drawing-1.png'
        )
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { createSavedDrawing } = await import(
            '../netlify/lib/drawings'
        )
        const result = await createSavedDrawing('user-1', {
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle'
        })

        const imageCall = putDrawingImage.mock.calls[0]!
        const blob = imageCall[2] as Blob
        const dbCall = query.mock.calls[0]!

        expect(result).toEqual({
            id: 'drawing-1',
            created_at: '2026-05-10T12:00:00.000Z'
        })
        expect(imageCall[0]).toBe('user-1')
        expect(imageCall[1]).toBe(dbCall[1][0])
        expect(blob.type).toBe('image/png')
        await expect(blob.text()).resolves.toBe('image')
        expect(dbCall[0]).toContain('INSERT INTO drawings')
        expect(dbCall[1]).toEqual([
            imageCall[1],
            'user-1',
            'users/user-1/drawings/drawing-1.png',
            'A red circle',
            'A hand drawn red circle'
        ])
    })

    it('updates an owned drawing and deletes the previous blob', async () => {
        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('SELECT blob_key')) {
                return {
                    rows: [{
                        blob_key: 'users/user-1/drawings/old.png'
                    }]
                }
            }

            return {
                rows: [{
                    id: 'drawing-1',
                    updated_at: '2026-05-10T12:10:00.000Z'
                }]
            }
        })

        putDrawingImage.mockResolvedValue(
            'users/user-1/drawings/drawing-1.png'
        )
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { updateSavedDrawing } = await import(
            '../netlify/lib/drawings'
        )
        const result = await updateSavedDrawing('user-1', 'drawing-1', {
            image: 'data:image/png;base64,bmV3LWltYWdl',
            text: 'Updated text',
            alt_text: 'Updated alt text'
        })

        const updateCall = query.mock.calls[1]!

        expect(result).toEqual({
            id: 'drawing-1',
            updated_at: '2026-05-10T12:10:00.000Z'
        })
        expect(query.mock.calls[0]![1]).toEqual(['drawing-1', 'user-1'])
        expect(putDrawingImage.mock.calls[0]![0]).toBe('user-1')
        expect(putDrawingImage.mock.calls[0]![1]).toBe('drawing-1')
        expect(updateCall[0]).toContain('UPDATE drawings')
        expect(updateCall[0]).toContain('WHERE id = $1')
        expect(updateCall[0]).toContain('AND user_id = $2')
        expect(updateCall[1]).toEqual([
            'drawing-1',
            'user-1',
            'users/user-1/drawings/drawing-1.png',
            'Updated text',
            'Updated alt text'
        ])
        expect(deleteDrawingImage).toHaveBeenCalledWith(
            'users/user-1/drawings/old.png'
        )
    })
})
