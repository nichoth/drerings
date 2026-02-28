import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/preact'
import { ColorPicker } from '../src/components/color-picker'
import { State } from '../src/state'
import { HomeRoute } from '../src/routes/home'

const atramentTestState = vi.hoisted(() => ({
    readColor: null as null|(()=>string)
}))

vi.mock('@substrate-system/atrament', () => {
    return {
        default: class MockAtrament {
            color = '#000000'
            smoothing = 0
            clear = vi.fn()
            addEventListener = vi.fn()

            constructor () {
                atramentTestState.readColor = () => this.color
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
})

describe('HomeRoute color picker integration', () => {
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
})
