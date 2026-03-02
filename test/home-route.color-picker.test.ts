import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { ColorPicker } from '../src/components/color-picker'
import { State } from '../src/state'
import { HomeRoute } from '../src/routes/home'

const atramentTestState = vi.hoisted(() => ({
    readColor: null as null|(()=>string),
    readWeight: null as null|(()=>number),
    readMode: null as null|(()=>string),
    emitDirty: null as null|(()=>void),
    emitClean: null as null|(()=>void),
    constructCount: 0
}))

vi.mock('@substrate-system/atrament', () => {
    return {
        MODE_DRAW: 'draw',
        MODE_ERASE: 'erase',
        default: class MockAtrament {
            color = '#000000'
            weight = 4
            mode = 'draw'
            smoothing = 0
            clear = vi.fn()
            addEventListener = vi.fn((name:string, cb:()=>void) => {
                if (name === 'dirty') atramentTestState.emitDirty = cb
                if (name === 'clean') atramentTestState.emitClean = cb
            })
            destroy = vi.fn()

            constructor (
                canvas?:HTMLCanvasElement,
                config:{ width?:number, height?:number } = {}
            ) {
                if (canvas?.tagName === 'CANVAS') {
                    if (config.width) canvas.width = config.width
                    if (config.height) canvas.height = config.height
                }
                atramentTestState.constructCount += 1
                atramentTestState.readColor = () => this.color
                atramentTestState.readWeight = () => this.weight
                atramentTestState.readMode = () => this.mode
            }
        }
    }
})

vi.mock('@substrate-system/atrament/fill?worker', () => {
    return { default: {} }
})

describe('ColorPicker', () => {
    it('emits chosen color on input changes', () => {
        const onChange = vi.fn()
        render(h(ColorPicker, {
            id: 'test-color-picker',
            value: '#000000',
            onChange
        }))

        const input = screen.getByLabelText('Brush color') as
            HTMLInputElement
        fireEvent.input(input, {
            target: { value: '#22c55e' }
        })

        expect(onChange).toHaveBeenCalledWith('#22c55e')
    })

    it('exposes preset swatches as list items', () => {
        const onChange = vi.fn()
        render(h(ColorPicker, {
            id: 'test-color-picker',
            value: '#000000',
            onChange
        }))

        const swatchList = screen.getByRole('list', { name: 'Preset colors' })
        expect(within(swatchList).getAllByRole('listitem').length).toBeGreaterThan(0)
    })
})

describe('HomeRoute color picker integration', () => {
    beforeEach(() => {
        atramentTestState.constructCount = 0
        atramentTestState.emitDirty = null
        atramentTestState.emitClean = null
    })

    it('uses default atrament brush size', () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        expect(atramentTestState.readWeight?.()).toBe(4)
        expect((screen.getByLabelText('Brush size') as HTMLInputElement).value)
            .toBe('4')
    })

    it('updates atrament brush color from picker changes', () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const input = screen.getByLabelText('Brush color') as
            HTMLInputElement
        expect(atramentTestState.readColor?.()).toBe('#000000')

        fireEvent.input(input, {
            target: { value: '#3b82f6' }
        })

        expect(atramentTestState.readColor?.()).toBe('#3b82f6')
    })

    it('updates atrament brush size from slider changes', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const slider = screen.getByLabelText('Brush size') as HTMLInputElement
        slider.value = '13'
        fireEvent.change(slider)

        await waitFor(() => {
            expect(atramentTestState.readWeight?.()).toBe(13)
        })
        expect(slider.value).toBe('13')
        expect(screen.getByText('13')).toBeTruthy()
    })

    it('defaults eraser to unchecked draw mode', () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const eraser = screen.getByText('Eraser').closest('check-box')
        expect(eraser).toBeTruthy()
        expect(atramentTestState.readMode?.()).toBe('draw')
    })

    it('toggles atrament mode when eraser checkbox changes', () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const eraser = screen.getByText('Eraser').closest('check-box')
        expect(eraser).toBeTruthy()
        if (!eraser) return

        ;(eraser as HTMLInputElement & { checked:boolean }).checked = true
        fireEvent.change(eraser)
        expect(atramentTestState.readMode?.()).toBe('erase')

        ;(eraser as HTMLInputElement & { checked:boolean }).checked = false
        fireEvent.change(eraser)
        expect(atramentTestState.readMode?.()).toBe('draw')
    })

    it('does not recreate atrament when auth state changes', async () => {
        const state = State()
        state.auth.value = {
            registered: false,
            authenticated: false
        }

        render(h(HomeRoute, { state }))
        expect(atramentTestState.constructCount).toBe(1)

        state.auth.value = {
            registered: true,
            authenticated: true
        }

        await waitFor(() => {
            expect(screen.queryByText(/Need a Bluesky account/i)).toBeNull()
        })
        expect(atramentTestState.constructCount).toBe(1)
    })

    it('preserves existing canvas pixels when auth resolves', async () => {
        const state = State()
        state.auth.value = {
            registered: false,
            authenticated: false
        }

        const { container } = render(h(HomeRoute, { state }))
        const canvas = container.querySelector('#sketchpad') as
            HTMLCanvasElement|null
        expect(canvas).toBeTruthy()
        if (!canvas) return

        let alpha = 0
        let width = canvas.width
        let height = canvas.height

        Object.defineProperty(canvas, 'width', {
            configurable: true,
            get: () => width,
            set: (value:number) => {
                width = value
                alpha = 0
            }
        })
        Object.defineProperty(canvas, 'height', {
            configurable: true,
            get: () => height,
            set: (value:number) => {
                height = value
                alpha = 0
            }
        })

        const ctx = {
            fillStyle: '#000000',
            fillRect: () => {
                alpha = 255
            },
            getImageData: () => ({
                data: new Uint8ClampedArray([0, 0, 0, alpha])
            })
        }
        const getContextSpy = vi.spyOn(canvas, 'getContext')
            .mockReturnValue(ctx as unknown as CanvasRenderingContext2D)

        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, 1, 1)
        const before = ctx.getImageData().data[3]
        expect(before).toBeGreaterThan(0)

        state.auth.value = {
            registered: true,
            authenticated: true
        }

        await waitFor(() => {
            expect(screen.queryByText(/Need a Bluesky account/i)).toBeNull()
        })

        const after = ctx.getImageData().data[3]
        expect(after).toBeGreaterThan(0)
        expect(atramentTestState.constructCount).toBe(1)
        getContextSpy.mockRestore()
    })

    it('renders post and alt counters with Bluesky limits', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        const { container } = render(h(HomeRoute, { state }))
        const textCounter = container.querySelector(
            'character-counter[data-counter-for="text"]'
        )
        const altCounter = container.querySelector(
            'character-counter[data-counter-for="alt-text"]'
        )

        expect(textCounter).toBeTruthy()
        expect(altCounter).toBeTruthy()
        expect(textCounter?.getAttribute('max')).toBe('300')
        expect(altCounter?.getAttribute('max')).toBe('2000')
        expect(textCounter?.getAttribute('count')).toBe('0')
        expect(altCounter?.getAttribute('count')).toBe('0')

        const textInput = screen.getByLabelText('Text') as HTMLTextAreaElement
        const altInput = screen.getByLabelText('Alt text') as HTMLTextAreaElement

        fireEvent.input(textInput, {
            target: { value: 'hello' }
        })
        fireEvent.input(altInput, {
            target: { value: 'description' }
        })

        await waitFor(() => {
            expect(textCounter?.getAttribute('count')).toBe('5')
        })
        expect(altCounter?.getAttribute('count')).toBe('11')
    })

    it('disables Post It when text is over 300 and enables at 300', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const button = screen.getByRole('button', {
            name: 'Post It'
        }) as HTMLButtonElement
        const textInput = screen.getByLabelText('Text') as HTMLTextAreaElement

        expect(button.disabled).toBe(true)
        atramentTestState.emitDirty?.()
        await waitFor(() => {
            expect(button.disabled).toBe(false)
            expect(textInput.disabled).toBe(false)
        })

        fireEvent.input(textInput, {
            target: { value: 'a'.repeat(301) }
        })
        await waitFor(() => {
            expect(button.disabled).toBe(true)
        })

        fireEvent.input(textInput, {
            target: { value: 'a'.repeat(300) }
        })
        await waitFor(() => {
            expect(button.disabled).toBe(false)
        })
    })

    it('disables Post It when alt text is over 2000 and enables at 2000', async () => {
        const state = State()
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        render(h(HomeRoute, { state }))

        const button = screen.getByRole('button', {
            name: 'Post It'
        }) as HTMLButtonElement
        const altInput = screen.getByLabelText('Alt text') as HTMLTextAreaElement

        expect(button.disabled).toBe(true)
        atramentTestState.emitDirty?.()
        await waitFor(() => {
            expect(button.disabled).toBe(false)
            expect(altInput.disabled).toBe(false)
        })

        fireEvent.input(altInput, {
            target: { value: 'a'.repeat(2001) }
        })
        await waitFor(() => {
            expect(button.disabled).toBe(true)
        })

        fireEvent.input(altInput, {
            target: { value: 'a'.repeat(2000) }
        })
        await waitFor(() => {
            expect(button.disabled).toBe(false)
        })
    })
})
