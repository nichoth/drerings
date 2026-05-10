import { beforeEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rowCount?:number; rows:Array<Record<string, unknown>> }>

describe('US-011 publish post helpers', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('inserts a public post for an owned drawing', async () => {
        const query = vi.fn<Query>(async () => {
            return { rows: [{ id: 42 }] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { publishDrawing } = await import('../netlify/lib/posts')
        const post = await publishDrawing('user-1', 'drawing-1')

        expect(post).toEqual({ id: 42 })
        expect(query).toHaveBeenCalledTimes(1)
        expect(query.mock.calls[0]![0]).toContain('INSERT INTO public_posts')
        expect(query.mock.calls[0]![0]).toContain('ON CONFLICT')
        expect(query.mock.calls[0]![0]).toContain('WHERE id = $1')
        expect(query.mock.calls[0]![0]).toContain('AND user_id = $2')
        expect(query.mock.calls[0]![1]).toEqual(['drawing-1', 'user-1'])
    })

    it('returns null when the drawing is not owned', async () => {
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

        const { publishDrawing } = await import('../netlify/lib/posts')
        const post = await publishDrawing('user-1', 'drawing-2')

        expect(post).toBe(null)
    })
})
