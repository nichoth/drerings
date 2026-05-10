import { beforeEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const getDrawingImage = vi.fn()

vi.mock('../netlify/lib/drawing-images', () => {
    return {
        getDrawingImage,
        putDrawingImage: vi.fn(),
        deleteDrawingImage: vi.fn()
    }
})

describe('US-009 drawing read helpers', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('lists saved drawings with image data URLs', async () => {
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'drawing-1',
                    blob_key: 'users/user-1/drawings/drawing-1.png',
                    text: 'A red circle',
                    alt_text: 'A hand drawn red circle',
                    updated_at: '2026-05-10T12:10:00.000Z'
                }]
            }
        })

        getDrawingImage.mockResolvedValue(
            new Blob(['image'], { type: 'image/png' })
        )
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { listSavedDrawings } = await import(
            '../netlify/lib/drawings'
        )
        const drawings = await listSavedDrawings('user-1')

        expect(query.mock.calls[0]![0]).toContain('FROM drawings')
        expect(query.mock.calls[0]![0]).toContain('WHERE user_id = $1')
        expect(query.mock.calls[0]![1]).toEqual(['user-1'])
        expect(drawings).toEqual([{
            id: 'drawing-1',
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            updated_at: '2026-05-10T12:10:00.000Z'
        }])
    })

    it('returns null when an owned drawing is missing', async () => {
        const query = vi.fn<Query>(async () => {
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { getSavedDrawing } = await import('../netlify/lib/drawings')
        const drawing = await getSavedDrawing('user-1', 'missing')

        expect(drawing).toBe(null)
        expect(getDrawingImage).not.toHaveBeenCalled()
    })
})
