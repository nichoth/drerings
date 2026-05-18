import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { State } from '../src/state'
import { HomeRoute } from '../src/routes/home'

vi.mock('@substrate-system/atrament', () => {
    return {
        MODE_DRAW: 'draw',
        MODE_ERASE: 'erase',
        default: class MockAtrament {
            color = '#000000'
            weight = 4
            mode = 'draw'
            smoothing = 0
            destroy = vi.fn()

            constructor (
                canvas?:HTMLCanvasElement,
                config:{ width?:number, height?:number } = {}
            ) {
                if (canvas?.tagName === 'CANVAS') {
                    if (config.width) canvas.width = config.width
                    if (config.height) canvas.height = config.height
                }
            }
        }
    }
})

vi.mock('@substrate-system/atrament/fill?worker', () => {
    return { default: {} }
})

describe('US-007 drawing canvas', () => {
    it('loads the canvas for all visitors', () => {
        const state = State()

        const { container } = render(h(HomeRoute, { state }))

        expect(container.querySelector('#sketchpad')).toBeTruthy()
        expect(screen.getByLabelText('Text')).toBeTruthy()
        expect(screen.getByLabelText('Alt text')).toBeTruthy()
    })
})
