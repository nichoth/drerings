import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'

type QueryRow = Record<string, unknown>
type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:QueryRow[] }>

function installDbMockWithGiftRow (giftRow:QueryRow):ReturnType<
    typeof vi.fn<Query>
> {
    const query = vi.fn<Query>(async (sql:string) => {
        if (sql.includes('FROM stamp_lots') &&
            sql.includes('gift_received')) {
            return { rows: [giftRow] }
        }
        return { rows: [] }
    })

    vi.doMock('@netlify/database', () => ({
        getDatabase: () => ({
            pool: {
                query,
                connect: vi.fn(async () => ({
                    query,
                    release: vi.fn()
                }))
            }
        })
    }))

    return query
}

describe('US-038 gift refund 30-day boundary', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.resetModules()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.resetModules()
    })

    it(
        'AC14.1 refundable inside 30-day window (29d 23h 59m)',
        async () => {
            const createdAt = new Date('2026-05-10T12:00:00Z')
            // 30 days later => 2026-06-09T12:00:00Z. One minute before
            // that boundary the gift is still refundable.
            const now = new Date('2026-06-09T11:59:00Z')

            const giftRow = {
                id: 'gift-1',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,
                price_paid_cents: 1000,
                created_at: createdAt.toISOString()
            }

            installDbMockWithGiftRow(giftRow)

            const { listSentGiftsForSender } = await import(
                '../netlify/lib/stamps.js'
            )

            const summaries = await listSentGiftsForSender(
                'sender-1',
                now
            )

            expect(summaries).toHaveLength(1)
            const gift = summaries[0]
            expect(gift.id).toBe('gift-1')
            expect(gift.refundable).toBe(true)
            expect(gift.status).toBe('unused')
            expect(gift.refund_cents).toBe(1000)
            expect(gift.refundable_until).toBe(
                '2026-06-09T12:00:00.000Z'
            )
        }
    )

    it(
        'AC14.2 NOT refundable outside 30-day window (30d 1s)',
        async () => {
            const createdAt = new Date('2026-05-10T12:00:00Z')
            // Just 1 second past the 30-day boundary.
            const now = new Date('2026-06-09T12:00:01Z')

            const giftRow = {
                id: 'gift-2',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,
                price_paid_cents: 1000,
                created_at: createdAt.toISOString()
            }

            installDbMockWithGiftRow(giftRow)

            const { listSentGiftsForSender } = await import(
                '../netlify/lib/stamps.js'
            )

            const summaries = await listSentGiftsForSender(
                'sender-1',
                now
            )

            expect(summaries).toHaveLength(1)
            const gift = summaries[0]
            expect(gift.refundable).toBe(false)
            // Past the window but lot is still full -> expired
            expect(gift.status).toBe('expired')
            expect(gift.refund_cents).toBe(0)
        }
    )

    it(
        'AC14.3 NOT refundable when lot is partially used (in_use)',
        async () => {
            // Well inside the window, but one stamp has been used.
            const createdAt = new Date('2026-05-10T12:00:00Z')
            const now = new Date('2026-05-11T12:00:00Z')

            const giftRow = {
                id: 'gift-3',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 9,
                price_paid_cents: 1000,
                created_at: createdAt.toISOString()
            }

            installDbMockWithGiftRow(giftRow)

            const { listSentGiftsForSender } = await import(
                '../netlify/lib/stamps.js'
            )

            const summaries = await listSentGiftsForSender(
                'sender-1',
                now
            )

            expect(summaries).toHaveLength(1)
            const gift = summaries[0]
            expect(gift.refundable).toBe(false)
            expect(gift.status).toBe('in_use')
            expect(gift.refund_cents).toBe(0)
            expect(gift.remaining_count).toBe(9)
        }
    )

    it(
        'AC14 boundary: exactly at refundable_until is still refundable',
        async () => {
            const createdAt = new Date('2026-05-10T12:00:00Z')
            // Exactly at the boundary: now == createdAt + 30 days
            const now = new Date('2026-06-09T12:00:00Z')

            const giftRow = {
                id: 'gift-4',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,
                price_paid_cents: 1000,
                created_at: createdAt.toISOString()
            }

            installDbMockWithGiftRow(giftRow)

            const { listSentGiftsForSender } = await import(
                '../netlify/lib/stamps.js'
            )

            const summaries = await listSentGiftsForSender(
                'sender-1',
                now
            )

            expect(summaries[0].refundable).toBe(true)
        }
    )

    it(
        'AC14 price_paid_cents=0 is not refundable even when full+inWindow',
        async () => {
            const createdAt = new Date('2026-05-10T12:00:00Z')
            const now = new Date('2026-05-11T12:00:00Z')

            const giftRow = {
                id: 'gift-5',
                recipient_email: 'recipient@example.com',
                original_count: 10,
                remaining_count: 10,
                price_paid_cents: 0,
                created_at: createdAt.toISOString()
            }

            installDbMockWithGiftRow(giftRow)

            const { listSentGiftsForSender } = await import(
                '../netlify/lib/stamps.js'
            )

            const summaries = await listSentGiftsForSender(
                'sender-1',
                now
            )

            expect(summaries[0].refundable).toBe(false)
            expect(summaries[0].refund_cents).toBe(0)
        }
    )
})
