import { beforeEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rowCount?:number; rows:Array<Record<string, unknown>> }>

const deleteDrawingImage = vi.fn()

vi.mock('../netlify/lib/drawing-images', () => {
    return {
        getDrawingImage: vi.fn(),
        putDrawingImage: vi.fn(),
        deleteDrawingImage
    }
})

describe('US-010 drawing delete helpers', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('deletes an owned drawing, public post, and image blob', async () => {
        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('SELECT blob_key')) {
                return {
                    rows: [{
                        blob_key: 'users/user-1/drawings/drawing-1.png'
                    }]
                }
            }

            return { rowCount: 1, rows: [] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { deleteSavedDrawing } = await import(
            '../netlify/lib/drawings'
        )
        const deleted = await deleteSavedDrawing('user-1', 'drawing-1')

        expect(deleted).toBe(true)
        expect(query.mock.calls[0]![0]).toContain('SELECT blob_key')
        expect(query.mock.calls[0]![0]).toContain('WHERE id = $1')
        expect(query.mock.calls[0]![0]).toContain('AND user_id = $2')
        expect(query.mock.calls[0]![1]).toEqual(['drawing-1', 'user-1'])
        expect(query.mock.calls[1]![0]).toContain('DELETE FROM public_posts')
        expect(query.mock.calls[1]![1]).toEqual(['drawing-1'])
        expect(query.mock.calls[2]![0]).toContain('DELETE FROM drawings')
        expect(query.mock.calls[2]![0]).toContain('AND user_id = $2')
        expect(query.mock.calls[2]![1]).toEqual(['drawing-1', 'user-1'])
        expect(deleteDrawingImage).toHaveBeenCalledWith(
            'users/user-1/drawings/drawing-1.png'
        )
    })

    it('does not delete anything when the drawing is not owned', async () => {
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

        const { deleteSavedDrawing } = await import(
            '../netlify/lib/drawings'
        )
        const deleted = await deleteSavedDrawing('user-1', 'drawing-2')

        expect(deleted).toBe(false)
        expect(query).toHaveBeenCalledTimes(1)
        expect(deleteDrawingImage).not.toHaveBeenCalled()
    })
})
