import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import {
    fireEvent,
    render,
    screen,
    within
} from '@testing-library/preact'
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

describe('US-007 free-user drawing experience', () => {
    it('loads the canvas for anonymous visitors', () => {
        const state = State()

        const { container } = render(h(HomeRoute, { state }))

        expect(container.querySelector('#sketchpad')).toBeTruthy()
        expect(screen.getByLabelText('Text')).toBeTruthy()
        expect(screen.getByLabelText('Alt text')).toBeTruthy()
    })

    it('warns free users that drawings are not saved', () => {
        const state = State()

        render(h(HomeRoute, { state }))

        expect(screen.getByText(/drawings aren't saved on free accounts/i))
            .toBeTruthy()

        const banner = screen.getByRole('status', {
            name: 'Free account save warning'
        })
        const link = within(banner).getByRole('link', {
            name: /upgrade to keep them/i
        }) as HTMLAnchorElement

        expect(link.getAttribute('href')).toBe('/pricing')
    })

    it('disables paid actions for anonymous visitors', () => {
        const state = State()

        render(h(HomeRoute, { state }))

        const save = screen.getByRole('button', { name: 'Save' }) as
            HTMLButtonElement
        const send = screen.getByRole('button', { name: 'Send It' }) as
            HTMLButtonElement
        const tooltip = screen.getByRole('tooltip', {
            name: 'Paid drawing controls'
        })

        expect(save.disabled).toBe(true)
        expect(send.disabled).toBe(true)
        expect(save.getAttribute('aria-describedby'))
            .toBe(tooltip.getAttribute('id'))
        expect(send.getAttribute('aria-describedby'))
            .toBe(tooltip.getAttribute('id'))
        expect(tooltip.textContent).toMatch(/upgrade to keep drawings/i)

        const link = within(tooltip).getByRole('link', {
            name: /pricing/i
        }) as HTMLAnchorElement
        expect(link.getAttribute('href')).toBe('/pricing')
    })

    it('does not persist free-user drawings to storage or the backend', () => {
        const state = State()
        const fetcher = vi.fn()
        const setItem = vi.spyOn(Storage.prototype, 'setItem')
        const getItem = vi.spyOn(Storage.prototype, 'getItem')

        vi.stubGlobal('fetch', fetcher)

        render(h(HomeRoute, { state }))

        fireEvent.input(screen.getByLabelText('Text'), {
            target: { value: 'kept only in memory' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(fetcher).not.toHaveBeenCalled()
        expect(setItem).not.toHaveBeenCalled()
        expect(getItem).not.toHaveBeenCalled()
    })
})
