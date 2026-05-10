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

describe('US-012 public post helpers', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('loads a published post with its drawing image', async () => {
        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 42,
                    blob_key: 'users/user-1/drawings/drawing-1.png',
                    text: 'A red circle',
                    alt_text: 'A hand drawn red circle',
                    published_at: '2026-05-10T12:20:00.000Z'
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

        const postStore = await import('../netlify/lib/posts')
        const getPublishedPost = (postStore as {
            getPublishedPost?:(id:number)=>Promise<unknown>
        }).getPublishedPost

        expect(getPublishedPost).toEqual(expect.any(Function))

        const post = await getPublishedPost!(42)

        expect(query.mock.calls[0]![0]).toContain('FROM public_posts')
        expect(query.mock.calls[0]![0]).toContain('JOIN drawings')
        expect(query.mock.calls[0]![0]).toContain('WHERE public_posts.id = $1')
        expect(query.mock.calls[0]![1]).toEqual([42])
        expect(post).toEqual({
            id: 42,
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            published_at: '2026-05-10T12:20:00.000Z'
        })
    })

    it('returns null when the published post is missing', async () => {
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

        const postStore = await import('../netlify/lib/posts')
        const getPublishedPost = (postStore as {
            getPublishedPost?:(id:number)=>Promise<unknown>
        }).getPublishedPost

        expect(getPublishedPost).toEqual(expect.any(Function))
        expect(await getPublishedPost!(999)).toBe(null)
        expect(getDrawingImage).not.toHaveBeenCalled()
    })
})
