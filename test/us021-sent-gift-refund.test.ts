import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-021 sender gift refunds', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('lists sent gifts with refundable and final statuses', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => ({
            rows: [
                {
                    id: 'lot-unused',
                    recipient_handle: 'friend.bsky.social',
                    original_count: 25,
                    remaining_count: 25,
                    price_paid_cents: 1000,
                    created_at: '2026-05-01T00:00:00.000Z'
                },
                {
                    id: 'lot-used',
                    recipient_handle: 'pal.bsky.social',
                    original_count: 25,
                    remaining_count: 24,
                    price_paid_cents: 1000,
                    created_at: '2026-05-01T00:00:00.000Z'
                }
            ]
        }))

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { listSentGiftsForSender } = await import(
            '../netlify/lib/stamps'
        )
        const gifts = await listSentGiftsForSender(
            'sender-1',
            new Date('2026-05-15T00:00:00.000Z')
        )

        expect(gifts).toEqual([
            {
                id: 'lot-unused',
                recipient_handle: 'friend.bsky.social',
                original_count: 25,
                remaining_count: 25,
                refund_cents: 1000,
                refundable: true,
                refundable_until: '2026-05-31T00:00:00.000Z',
                status: 'unused',
                created_at: '2026-05-01T00:00:00.000Z'
            },
            {
                id: 'lot-used',
                recipient_handle: 'pal.bsky.social',
                original_count: 25,
                remaining_count: 24,
                refund_cents: 0,
                refundable: false,
                refundable_until: '2026-05-31T00:00:00.000Z',
                status: 'in_use',
                created_at: '2026-05-01T00:00:00.000Z'
            }
        ])
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('gifted_by_user_id = $1'),
            ['sender-1']
        )
    })

    it('refunds an unused recipient gift lot in one transaction',
        async () => {
            vi.resetModules()

            const issueRefund = vi.fn(async () => {})
            const release = vi.fn()
            const clientQuery = vi.fn<Query>(async (sql) => {
                if (
                    sql.includes('FROM stamp_lots') &&
                    sql.includes('FOR UPDATE')
                ) {
                    return {
                        rows: [{
                            id: 'lot-unused',
                            user_id: 'recipient-1',
                            original_count: 25,
                            remaining_count: 25,
                            price_paid_cents: 1000,
                            autumn_checkout_id: 'checkout-gift-1',
                            created_at: '2026-05-01T00:00:00.000Z'
                        }]
                    }
                }

                if (sql.includes('UPDATE users')) {
                    return { rows: [{ stamps_balance: 5 }] }
                }

                return { rows: [] }
            })
            const connect = vi.fn(async () => ({
                query: clientQuery,
                release
            }))

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { connect }
                })
            }))

            const { refundSentGiftStampLot } = await import(
                '../netlify/lib/stamps'
            )
            const result = await refundSentGiftStampLot({
                senderUserId: 'sender-1',
                lotId: 'lot-unused',
                issueRefund,
                now: new Date('2026-05-15T00:00:00.000Z')
            })

            expect(result).toEqual({
                lotId: 'lot-unused',
                refundCents: 1000,
                recipientBalanceAfter: 5
            })
            expect(clientQuery).toHaveBeenCalledWith('BEGIN')
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('gifted_by_user_id = $2'),
                ['lot-unused', 'sender-1']
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('SET remaining_count = 0'),
                ['lot-unused', 'recipient-1']
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining(
                    'stamps_balance = stamps_balance - $1'
                ),
                [25, 'recipient-1']
            )
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_transactions'),
                [
                    'recipient-1',
                    'lot-unused',
                    -25,
                    'gift_reclaimed',
                    'checkout-gift-1',
                    5
                ]
            )
            expect(issueRefund).toHaveBeenCalledWith({
                checkoutId: 'checkout-gift-1',
                amountCents: 1000
            })
            expect(clientQuery).toHaveBeenCalledWith('COMMIT')
            expect(release).toHaveBeenCalled()
        })
})
