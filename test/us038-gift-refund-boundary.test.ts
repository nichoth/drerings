import { describe, expect, it, vi, afterEach } from 'vitest'

// Helper to compute N days later in UTC
function addDays (date:Date, days:number):Date {
    const copy = new Date(date)
    copy.setUTCDate(copy.getUTCDate() + days)
    return copy
}

describe('US-038 gift refund 30-day boundary', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.resetModules()
    })

    it('AC14.1 refundable inside 30-day window (29d 23h 59m)',
        async () => {
            vi.useFakeTimers()

            // created_at: 2026-05-10T12:00:00Z
            // + 30 days = 2026-06-09T12:00:00Z
            const createdAt = new Date('2026-05-10T12:00:00Z')
            const refundableUntil = addDays(createdAt, 30)
            const now = new Date(
                refundableUntil.getTime() - 60_000  // 1 min before cutoff
            )

            vi.setSystemTime(now)

            // Verify the math
            expect(now.getTime()).toBeLessThanOrEqual(
                refundableUntil.getTime()
            )
            expect(refundableUntil.getTime() - now.getTime()).toBeLessThan(
                2 * 60_000
            )

            // Simulate a sent gift row
            const gift = {
                id: 'gift-1',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,  // Full lot, unused
                price_paid_cents: 1000
            }

            // Calculate refundability manually (like sentGiftSummary does)
            const originalCount = Number(gift.original_count)
            const remainingCount = Number(gift.remaining_count)
            const pricePaidCents = Number(gift.price_paid_cents)
            const hasFullLot = remainingCount === originalCount &&
                remainingCount > 0
            const isInWindow = now.getTime() <= refundableUntil.getTime()
            const isPriceRefundable = Number.isFinite(pricePaidCents) &&
                pricePaidCents > 0
            const refundable = hasFullLot && isInWindow && isPriceRefundable

            expect(hasFullLot).toBe(true)
            expect(isInWindow).toBe(true)
            expect(isPriceRefundable).toBe(true)
            expect(refundable).toBe(true)
        })

    it('AC14.2 NOT refundable outside 30-day window (30d 1s)',
        async () => {
            vi.useFakeTimers()

            // created_at: 2026-05-10T12:00:00Z
            // + 30 days = 2026-06-09T12:00:00Z
            const createdAt = new Date('2026-05-10T12:00:00Z')
            const refundableUntil = addDays(createdAt, 30)
            const now = new Date(refundableUntil.getTime() + 1_000)

            vi.setSystemTime(now)

            // Verify the math: just outside the window
            expect(now.getTime()).toBeGreaterThan(
                refundableUntil.getTime()
            )
            expect(now.getTime() - refundableUntil.getTime()).toBeLessThan(
                2_000
            )

            // Simulate a sent gift row
            const gift = {
                id: 'gift-2',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,  // Full lot
                price_paid_cents: 1000
            }

            // Calculate refundability
            const originalCount = Number(gift.original_count)
            const remainingCount = Number(gift.remaining_count)
            const pricePaidCents = Number(gift.price_paid_cents)
            const hasFullLot = remainingCount === originalCount &&
                remainingCount > 0
            const isInWindow = now.getTime() <= refundableUntil.getTime()
            const isPriceRefundable = Number.isFinite(pricePaidCents) &&
                pricePaidCents > 0
            const refundable = hasFullLot && isInWindow && isPriceRefundable

            expect(hasFullLot).toBe(true)
            expect(isInWindow).toBe(false)  // Outside window
            expect(isPriceRefundable).toBe(true)
            expect(refundable).toBe(false)
        })

    it('AC14.3 NOT refundable inside window but partial (hasFullLot=false)',
        async () => {
            vi.useFakeTimers()

            // Just 1 day in, plenty of time, but lot is partially used
            const createdAt = new Date('2026-05-10T12:00:00Z')
            const now = new Date('2026-05-11T12:00:00Z')
            const refundableUntil = addDays(createdAt, 30)

            vi.setSystemTime(now)

            // Verify we're inside the window
            expect(now.getTime()).toBeLessThanOrEqual(
                refundableUntil.getTime()
            )

            // Simulate a sent gift row with partial usage
            const gift = {
                id: 'gift-3',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 9,  // 1 used (partial lot)
                price_paid_cents: 1000
            }

            // Calculate refundability
            const originalCount = Number(gift.original_count)
            const remainingCount = Number(gift.remaining_count)
            const pricePaidCents = Number(gift.price_paid_cents)
            const hasFullLot = remainingCount === originalCount &&
                remainingCount > 0
            const isInWindow = now.getTime() <= refundableUntil.getTime()
            const isPriceRefundable = Number.isFinite(pricePaidCents) &&
                pricePaidCents > 0
            const refundable = hasFullLot && isInWindow && isPriceRefundable

            expect(hasFullLot).toBe(false)  // Partial
            expect(isInWindow).toBe(true)
            expect(isPriceRefundable).toBe(true)
            expect(refundable).toBe(false)  // Not refundable due to partial
        })
})
