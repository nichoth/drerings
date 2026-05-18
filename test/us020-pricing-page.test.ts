import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/preact'
import { PricingRoute } from '../src/routes/pricing'
import { State } from '../src/state'

describe('PricingRoute', () => {
    it('shows two pack rows', () => {
        const state = State()
        const { container } = render(
            h(PricingRoute, { state })
        )

        const packRows = container.querySelectorAll('.pack-row')
        expect(packRows.length).toBe(2)
    })

    it('opens BuyPackModal with productId when Buy is clicked', () => {
        const state = State()
        const spy = vi.spyOn(State, 'OpenBuyPackModal')
        const { getAllByText } = render(
            h(PricingRoute, { state })
        )

        const buyButtons = getAllByText('Buy')
        fireEvent.click(buyButtons[0])

        expect(spy).toHaveBeenCalledWith(
            state,
            expect.stringMatching(/^(10|25)_stamps$/)
        )
    })

    it('does NOT include a subscription email form', () => {
        const state = State()
        const { container } = render(
            h(PricingRoute, { state })
        )

        expect(
            container.querySelector('form.pricing-checkout-form')
        ).toBeNull()
    })
})
