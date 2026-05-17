import { describe, expect, it } from 'vitest'

import {
    calculateStampLotRefundCents,
    type StampLotRefundRow
} from '../netlify/lib/stamps'

function bigBundleLot (remaining:number):StampLotRefundRow {
    return {
        source: 'purchase',
        original_count: 60,
        remaining_count: remaining,
        price_paid_cents: 2000
    }
}

describe('US-036 refund formula edge cases (60 / $20.00)', () => {
    it('full refund of an untouched lot returns exactly 2000c', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(60))).toBe(2000)
    })

    it('59 remaining returns 1966c (floored)', () => {
        // 59 * 2000 / 60 = 1966.666...; floor → 1966
        expect(calculateStampLotRefundCents(bigBundleLot(59))).toBe(1966)
    })

    it('30 remaining returns exactly 1000c', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(30))).toBe(1000)
    })

    it('7 remaining returns 233c (floored)', () => {
        // 7 * 2000 / 60 = 233.333...; floor → 233
        expect(calculateStampLotRefundCents(bigBundleLot(7))).toBe(233)
    })

    it('1 remaining returns 33c (floored)', () => {
        // 1 * 2000 / 60 = 33.333...; floor → 33
        expect(calculateStampLotRefundCents(bigBundleLot(1))).toBe(33)
    })

    it('0 remaining returns 0', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(0))).toBe(0)
    })

    it('floor-rounding never overpays across any 60-bundle split',
        () => {
            for (let k = 1; k < 60; k++) {
                const refundLeft = calculateStampLotRefundCents(
                    bigBundleLot(k)
                )
                const refundRight = calculateStampLotRefundCents(
                    bigBundleLot(60 - k)
                )
                expect(refundLeft + refundRight)
                    .toBeLessThanOrEqual(2000)
            }
        })

    it('grant lots return 0 regardless of price field', () => {
        const grantLot:StampLotRefundRow = {
            source: 'grant',
            original_count: 5,
            remaining_count: 5,
            price_paid_cents: 9999   // nonsense — grants have no price
        }
        expect(calculateStampLotRefundCents(grantLot)).toBe(0)
    })

    it('gift_received lots return 0', () => {
        const giftLot:StampLotRefundRow = {
            source: 'gift_received',
            original_count: 25,
            remaining_count: 25,
            price_paid_cents: 1000
        }
        expect(calculateStampLotRefundCents(giftLot)).toBe(0)
    })
})
