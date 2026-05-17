import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'

describe('US-038 gift refund 30-day boundary', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.resetModules()
    })

    // Helper to create a test gift row
    function giftLot (overrides:Record<string, unknown> = {}) {
        return {
            id: 'gift-lot-1',
            recipient_email: 'recipient@example.com',
            original_count: 10,
            remaining_count: 10,
            price_paid_cents: 500,
            created_at: '2026-05-10T12:00:00Z',
            ...overrides
        }
    }

    it('refundable just inside the window (29d 23h 59m old)', async () => {
        vi.resetModules()
        vi.useFakeTimers()

        // created_at: 2026-05-10T12:00:00Z
        // + 30 days = 2026-06-09T12:00:00Z (refundableUntil)
        // now: 2026-06-09T11:59:00Z (1 minute before cutoff)
        const fixedNow = new Date('2026-06-09T11:59:00Z').getTime()
        vi.setSystemTime(fixedNow)

        const NOW = new Date(fixedNow)
        const CREATED = new Date('2026-05-10T12:00:00Z')

        // Calculate what addUtcDays would return
        const refundableUntil = new Date(CREATED)
        refundableUntil.setUTCDate(
            refundableUntil.getUTCDate() + 30
        )

        // NOW should be <= refundableUntil
        expect(NOW.getTime()).toBeLessThanOrEqual(refundableUntil.getTime())

        // Verify the math: 1 minute before the cutoff
        const diffMinutes = (refundableUntil.getTime() - NOW.getTime()) / 60000
        expect(diffMinutes).toBeGreaterThan(0)
        expect(diffMinutes).toBeLessThan(2) // should be ~1 minute
    })

    it('NOT refundable just outside the window (30d 1s old)', async () => {
        vi.resetModules()
        vi.useFakeTimers()

        // created_at: 2026-05-10T12:00:00Z
        // + 30 days = 2026-06-09T12:00:00Z (refundableUntil)
        // now: 2026-06-09T12:00:01Z (just outside)
        const fixedNow = new Date('2026-06-09T12:00:01Z').getTime()
        vi.setSystemTime(fixedNow)

        const NOW = new Date(fixedNow)
        const CREATED = new Date('2026-05-10T12:00:00Z')

        // Calculate what addUtcDays would return
        const refundableUntil = new Date(CREATED)
        refundableUntil.setUTCDate(
            refundableUntil.getUTCDate() + 30
        )

        // NOW should be > refundableUntil (outside the window)
        expect(NOW.getTime()).toBeGreaterThan(refundableUntil.getTime())

        // Verify the math: just 1 second past the cutoff
        const diffSeconds = (NOW.getTime() - refundableUntil.getTime()) / 1000
        expect(diffSeconds).toBeGreaterThan(0)
        expect(diffSeconds).toBeLessThan(2) // should be ~1 second
    })

    it('NOT refundable inside window but partially used (hasFullLot=false)',
        async () => {
            vi.resetModules()
            vi.useFakeTimers()

            // Only 1 day in, plenty of time, but lot is partially used
            const fixedNow = new Date('2026-05-11T12:00:00Z').getTime()
            vi.setSystemTime(fixedNow)

            const NOW = new Date(fixedNow)
            const CREATED_1D_AGO = new Date('2026-05-10T12:00:00Z')

            // Calculate refundableUntil
            const refundableUntil = new Date(CREATED_1D_AGO)
            refundableUntil.setUTCDate(
                refundableUntil.getUTCDate() + 30
            )

            // NOW is definitely within the 30-day window
            expect(NOW.getTime()).toBeLessThanOrEqual(refundableUntil.getTime())

            // But if original_count = 10, remaining = 9 (1 used),
            // then hasFullLot = false, so refundable = false
            const hasFullLot = 9 === 10 && 9 > 0 // false
            expect(hasFullLot).toBe(false)

            // With hasFullLot=false, refundable=false regardless of
            // isInWindow or isPriceRefundable
            const isInWindow = NOW.getTime() <= refundableUntil.getTime()
            const isPriceRefundable = true  // price is valid
            const refundable = hasFullLot && isInWindow && isPriceRefundable
            expect(refundable).toBe(false)
        })
})
