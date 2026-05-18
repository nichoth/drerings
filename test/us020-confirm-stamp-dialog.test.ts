import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/preact'
import { html } from 'htm/preact'
import {
    ConfirmStampDialog
} from '../src/components/confirm-stamp-dialog'

describe('ConfirmStampDialog', () => {
    it('Cancel click invokes onCancel and not onConfirm', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { getByRole } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${false}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        const cancelButton = getByRole('button', { name: 'Cancel' })
        fireEvent.click(cancelButton)

        expect(onCancel).toHaveBeenCalledOnce()
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('Confirm click invokes onConfirm and not onCancel', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { getByRole } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${false}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        const confirmButton = getByRole('button', {
            name: 'Use 1 stamp'
        })
        fireEvent.click(confirmButton)

        expect(onConfirm).toHaveBeenCalledOnce()
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('isSpinning disables Cancel button', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { getByRole } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${true}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        const cancelButton = getByRole('button', {
            name: 'Cancel'
        }) as HTMLButtonElement
        expect(cancelButton.disabled).toBe(true)
    })

    it('does not call onCancel via backdrop while isSpinning', () => {
        const onCancel = vi.fn()
        const onConfirm = vi.fn()
        const { container } = render(html`<${ConfirmStampDialog}
            stampsBalance=${5}
            isSpinning=${true}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
        />`)

        const backdrop = container.querySelector(
            '.confirm-stamp-dialog-backdrop'
        ) as HTMLElement
        fireEvent.click(backdrop)

        expect(onCancel).not.toHaveBeenCalled()
    })
})
