import { describe, expect, it, vi } from 'vitest'
import {
    canvasToBlob,
    canvasToSquareBlob,
    paramsFromQueryLike
} from '../src/util'

describe('query utilities', () => {
    it('strips prefix characters', () => {
        const fromQuery = paramsFromQueryLike('?state=abc&code=123')
        const fromHash = paramsFromQueryLike('#state=xyz&error=bad')

        expect(fromQuery.get('state')).toBe('abc')
        expect(fromQuery.get('code')).toBe('123')
        expect(fromHash.get('state')).toBe('xyz')
        expect(fromHash.get('error')).toBe('bad')
    })
})

describe('canvas utilities', () => {
    it('creates a blob from a canvas', async () => {
        const canvas = document.createElement('canvas')
        const blob = new Blob(['image'], { type: 'image/png' })
        vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
            callback(blob)
        })

        await expect(canvasToBlob(canvas, 'image/png'))
            .resolves.toBe(blob)
    })

    it('rejects when a canvas cannot create a blob', async () => {
        const canvas = document.createElement('canvas')
        vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
            callback(null)
        })

        await expect(canvasToBlob(canvas, 'image/png'))
            .rejects.toThrow('Could not create image blob')
    })

    it('pads non-square canvases before creating a blob', async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 6

        const context = {
            fillStyle: '',
            fillRect: vi.fn(),
            drawImage: vi.fn()
        }
        vi.spyOn(document, 'createElement').mockReturnValue({
            width: 0,
            height: 0,
            getContext: () => context,
            toBlob: (callback:(blob:Blob|null)=>void) => {
                callback(new Blob(['square'], { type: 'image/png' }))
            }
        } as unknown as HTMLCanvasElement)

        const blob = await canvasToSquareBlob(canvas, 'image/png')

        expect(blob.type).toBe('image/png')
        expect(context.fillRect).toHaveBeenCalledWith(0, 0, 10, 10)
        expect(context.drawImage).toHaveBeenCalledWith(canvas, 0, 2)
    })
})
