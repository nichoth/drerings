import { describe, expect, it } from 'vitest'

import {
    calculateStampLotRefundCents,
    type StampLotRefundRow
} from '../netlify/lib/stamps'

function lot (overrides:Partial<StampLotRefundRow>):StampLotRefundRow {
    return {
        source: 'purchase',
        original_count: 25,
        remaining_count: 25,
        price_paid_cents: 1000,
        ...overrides
    }
}

describe('US-014 refund calculation service', () => {
    it('returns the full paid amount for an unused purchase lot', () => {
        const refundCents = calculateStampLotRefundCents(lot({
            original_count: 10,
            remaining_count: 10,
            price_paid_cents: 500
        }))

        expect(refundCents).toBe(500)
    })

    it('prorates partially used purchase lots with integer math', () => {
        const refundCents = calculateStampLotRefundCents(lot({
            original_count: 25,
            remaining_count: 15,
            price_paid_cents: 1000
        }))

        expect(refundCents).toBe(600)
    })

    it('returns zero for a fully used purchase lot', () => {
        const refundCents = calculateStampLotRefundCents(lot({
            remaining_count: 0
        }))

        expect(refundCents).toBe(0)
    })

    it('returns zero for grant lots', () => {
        const refundCents = calculateStampLotRefundCents(lot({
            source: 'grant',
            price_paid_cents: null
        }))

        expect(refundCents).toBe(0)
    })

    it('returns zero for gift lots', () => {
        const refundCents = calculateStampLotRefundCents(lot({
            source: 'gift_received',
            price_paid_cents: 1000
        }))

        expect(refundCents).toBe(0)
    })
})
