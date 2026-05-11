import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function pngSize (path:string) {
    const bytes = readFileSync(path)
    const signature = bytes.subarray(0, 8).toString('hex')

    expect(signature).toBe('89504e470d0a1a0a')

    return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20)
    }
}

describe('US-021 PWA icon PNG assets', () => {
    it('provides install icons at standard manifest sizes', () => {
        expect(pngSize('public/icon.png')).toEqual({
            width: 1430,
            height: 808
        })

        expect(pngSize('public/icon-192.png')).toEqual({
            width: 192,
            height: 192
        })

        expect(pngSize('public/icon-512.png')).toEqual({
            width: 512,
            height: 512
        })
    })

    it('provides a 512px maskable icon generated from the same source', () => {
        expect(pngSize('public/icon-512-maskable.png')).toEqual({
            width: 512,
            height: 512
        })
    })
})
