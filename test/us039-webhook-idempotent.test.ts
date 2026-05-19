import { afterEach, describe, expect, it, vi } from 'vitest'

describe('US-039 webhook idempotency (applyStampCheckout)', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('AC9.1: DuplicateStampCheckoutError → already_credited', () => {
        it('catches DuplicateStampCheckoutError from creditStampLot ' +
            'and returns already_credited',
        async () => {
            vi.resetModules()

            const { DuplicateStampCheckoutError } = await import(
                '../netlify/lib/stamps.js'
            )

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...(actual as object),
                    creditStampLot: vi.fn(async () => {
                        throw new DuplicateStampCheckoutError()
                    })
                }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: {
                            query: vi.fn(async () => {
                                return { rows: [] }
                            })
                        }
                    })
                }
            })

            vi.doMock('../netlify/lib/resend.js', () => {
                return {
                    sendStampGiftEmail: vi.fn(),
                    sendPendingGiftInviteEmail: vi.fn()
                }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing.js'
            )

            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-dup',
                    product_id: '10_stamps',
                    customer_id: 'user-1'
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'already_credited'
            })
        })
    })

    describe('AC9.2: fast path optimization preserved', () => {
        it('returns already_credited on fast path without calling ' +
            'credit functions',
        async () => {
            vi.resetModules()

            let creditStampLotCalled = false
            const queryMock = vi.fn(async (sql) => {
                if (sql.includes('SELECT 1')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: {
                            query: queryMock
                        }
                    })
                }
            })

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...(actual as object),
                    creditStampLot: vi.fn(async () => {
                        creditStampLotCalled = true
                        throw new Error(
                            'creditStampLot should not be called'
                        )
                    })
                }
            })

            vi.doMock('../netlify/lib/resend.js', () => {
                return {
                    sendStampGiftEmail: vi.fn(),
                    sendPendingGiftInviteEmail: vi.fn()
                }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing.js'
            )

            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-fast-path',
                    product_id: '10_stamps',
                    customer_id: 'user-1'
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'already_credited'
            })
            expect(creditStampLotCalled).toBe(false)
        })
    })

    describe('AC9.3: defensive — already credited on retry', () => {
        it('returns already_credited when 23505 is caught from ' +
            'createPendingGift',
        async () => {
            vi.resetModules()

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...(actual as object),
                    createPendingGift: vi.fn(async () => {
                        const err:any = new Error('unique violation')
                        err.code = '23505'
                        throw err
                    })
                }
            })

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: {
                            query: vi.fn(async () => {
                                return { rows: [] }
                            })
                        }
                    })
                }
            })

            vi.doMock('../netlify/lib/resend.js', () => {
                return {
                    sendStampGiftEmail: vi.fn(),
                    sendPendingGiftInviteEmail: vi.fn()
                }
            })

            const { applyAutumnWebhookEvent } = await import(
                '../netlify/lib/billing.js'
            )

            const result = await applyAutumnWebhookEvent({
                type: 'checkout.completed',
                data: {
                    checkout_id: 'checkout-pending-dup',
                    product_id: '10_stamps',
                    customer: {
                        id: 'sender-1'
                    },
                    metadata: {
                        gift_sender_user_id: 'sender-1',
                        gift_sender_handle: 'sender.bsky.social',
                        gift_pending_recipient_email: 'recipient@example.com'
                    }
                }
            })

            expect(result).toEqual({
                handled: true,
                stamp_purchase: 'already_credited'
            })
        })
    })
})
