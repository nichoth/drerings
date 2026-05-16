import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-018 pending gift webhook', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('records a pending gift and sends an invitation email',
        async () => {
            vi.resetModules()

            const sendPendingGiftInviteEmail = vi.fn(async () => {})
            const query = vi.fn<Query>(async (sql) => {
                if (sql.includes('INSERT INTO pending_gifts')) {
                    return {
                        rows: [{
                            id: 'pending-gift-1',
                            recipient_email: 'new-friend@example.com',
                            pack_id: 'stamps_bundle',
                            count: 25,
                            price_cents: 1000,
                            status: 'pending',
                            created_at: '2026-05-15T00:00:00.000Z'
                        }]
                    }
                }

                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/resend.js', () => {
                return {
                    sendPendingGiftInviteEmail,
                    sendStampGiftEmail: vi.fn()
                }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing'
            )
            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-pending-gift-1',
                    product_id: 'stamps_bundle',
                    customer: {
                        id: 'sender-1'
                    },
                    metadata: {
                        gift_sender_user_id: 'sender-1',
                        gift_sender_email: 'sender@example.com',
                        gift_pending_recipient_email:
                            'new-friend@example.com'
                    }
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'pending_gift_created'
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('FROM stamp_transactions'),
                ['checkout-pending-gift-1']
            )
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO pending_gifts'),
                [
                    'sender-1',
                    'new-friend@example.com',
                    'stamps_bundle',
                    25,
                    1000,
                    'checkout-pending-gift-1'
                ]
            )
            expect(sendPendingGiftInviteEmail).toHaveBeenCalledWith({
                email: 'new-friend@example.com',
                senderEmail: 'sender@example.com',
                count: 25,
                signupUrl:
                    'https://drerings.app/login?gift=checkout-pending-gift-1'
            })
        })
})
