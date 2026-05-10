import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn()
}

const getStore = vi.fn(() => store)

vi.mock('@netlify/blobs', () => {
    return { getStore }
})

describe('US-003 drawing image blobs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('stores drawing images in the drawings blob store', async () => {
        const { putDrawingImage } = await import(
            '../netlify/lib/drawing-images'
        )
        const blob = new Blob(['image-bytes'], { type: 'image/png' })

        const blobKey = await putDrawingImage(
            'user-123',
            'drawing-456',
            blob
        )

        expect(blobKey).toBe('users/user-123/drawings/drawing-456.png')
        expect(getStore).toHaveBeenCalledWith('drawings')
        expect(store.set).toHaveBeenCalledWith(blobKey, blob)
    })

    it('reads drawing image bytes from the drawings blob store', async () => {
        const bytes = new ArrayBuffer(8)
        store.get.mockResolvedValue(bytes)
        const { getDrawingImage } = await import(
            '../netlify/lib/drawing-images'
        )

        await expect(getDrawingImage('users/user/drawings/drawing.png'))
            .resolves.toBe(bytes)
        expect(getStore).toHaveBeenCalledWith('drawings')
        expect(store.get).toHaveBeenCalledWith(
            'users/user/drawings/drawing.png',
            { type: 'arrayBuffer' }
        )
    })

    it('returns null when a drawing image is missing', async () => {
        store.get.mockResolvedValue(null)
        const { getDrawingImage } = await import(
            '../netlify/lib/drawing-images'
        )

        await expect(getDrawingImage('missing-key')).resolves.toBeNull()
    })

    it('deletes drawing images from the drawings blob store', async () => {
        const { deleteDrawingImage } = await import(
            '../netlify/lib/drawing-images'
        )

        await deleteDrawingImage('users/user/drawings/drawing.png')

        expect(getStore).toHaveBeenCalledWith('drawings')
        expect(store.delete).toHaveBeenCalledWith(
            'users/user/drawings/drawing.png'
        )
    })
})
