import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

type Query = (
    _sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-032 Resend bounce handler', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    describe('AC6.1: Hard bounce → refund', () => {
        it('refunds stamp using refundPostcardBounce on hard bounce',
            async () => {
                vi.resetModules()

                const postcardId = crypto.randomUUID()
                const userId = crypto.randomUUID()
                const lotId = crypto.randomUUID()

                const query = vi.fn<Query>(async (_sql) => {
                    return { rows: [] }
                })

                const refundPostcardBounce = vi.fn().mockResolvedValue({
                    refunded: true,
                    balanceAfter: 5
                })
                const getPostcardByResendEmailId = vi.fn().mockResolvedValue({
                    id: postcardId,
                    sender_id: userId,
                    lot_id: lotId,
                    status: 'sent'
                })

                vi.doMock('@netlify/database', () => {
                    return {
                        getDatabase: () => ({
                            pool: { query }
                        })
                    }
                })

                vi.doMock('../netlify/lib/postcards.js', () => {
                    return {
                        getPostcardByResendEmailId,
                        refundPostcardBounce
                    }
                })

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                const result = await resendWebhook.handleResendEvent({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_test123',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                expect(result).toEqual({
                    received: true,
                    refunded: true
                })
                expect(refundPostcardBounce).toHaveBeenCalledWith(postcardId)
            }
        )
    })

    describe('AC6.2: Transient bounce ignored', () => {
        it('returns transient reason and does not refund on soft bounce',
            async () => {
                vi.resetModules()

                const refundFailedSend = vi
                    .fn()
                    .mockResolvedValue(undefined)

                vi.doMock('../netlify/lib/stamps.js', () => {
                    return {
                        refundFailedSend
                    }
                })

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                const result = await resendWebhook.handleResendEvent({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_test123',
                        bounce: { type: 'soft_bounce' }
                    }
                })

                expect(result).toEqual({
                    received: true,
                    refunded: false,
                    reason: 'transient'
                })
                expect(refundFailedSend).not.toHaveBeenCalled()
            })
    })

    describe('AC6.3: Unknown email_id ignored', () => {
        it(
            'returns not_a_postcard when email_id is not found',
            async () => {
                vi.resetModules()

                const getPostcardByResendEmailId = vi
                    .fn()
                    .mockResolvedValue(null)

                vi.doMock('../netlify/lib/postcards.js', () => {
                    return {
                        getPostcardByResendEmailId
                    }
                })

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                const result = await resendWebhook.handleResendEvent({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_unknown',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                expect(result).toEqual({
                    received: true,
                    refunded: false,
                    reason: 'not_a_postcard'
                })
            }
        )
    })

    describe('AC6.4: Already-refunded postcards are no-ops', () => {
        it(
            'returns already_refunded when postcard already has that status',
            async () => {
                vi.resetModules()

                const postcardId = crypto.randomUUID()

                const refundFailedSend = vi
                    .fn()
                    .mockResolvedValue(undefined)
                const markFailedRefunded = vi
                    .fn()
                    .mockResolvedValue(undefined)
                const getPostcardByResendEmailId = vi
                    .fn()
                    .mockResolvedValue({
                        id: postcardId,
                        status: 'failed_refunded'
                    })

                vi.doMock('../netlify/lib/stamps.js', () => {
                    return {
                        refundFailedSend
                    }
                })

                vi.doMock('../netlify/lib/postcards.js', () => {
                    return {
                        getPostcardByResendEmailId,
                        markFailedRefunded
                    }
                })

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                const result = await resendWebhook.handleResendEvent({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_test123',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                expect(result).toEqual({
                    received: true,
                    refunded: false,
                    reason: 'already_refunded'
                })
                expect(refundFailedSend).not.toHaveBeenCalled()
                expect(markFailedRefunded).not.toHaveBeenCalled()
            }
        )
    })

    describe('AC6.5: Other event types ignored', () => {
        it('ignores email.delivered events', async () => {
            vi.resetModules()

            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query: vi.fn() }
                    })
                }
            })

            const resendWebhook = await import(
                '../netlify/lib/resend-webhook'
            )
            const result = await resendWebhook.handleResendEvent({
                type: 'email.delivered',
                data: { email_id: 're_test123' }
            })

            expect(result).toEqual({
                received: true,
                refunded: false,
                reason: 'unhandled_event'
            })
        })
    })

    describe('AC7.1: Missing signature headers', () => {
        it('returns invalid_signature when headers missing', async () => {
            vi.resetModules()

            vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

            const resendWebhook = await import(
                '../netlify/lib/resend-webhook'
            )
            const result = resendWebhook.verifyResendSignature(
                '{"type":"email.bounced"}',
                {}
            )

            expect(result).toBe('invalid_signature')
        })
    })

    describe('AC7.2: Bad signature', () => {
        it('returns invalid_signature with wrong signature', async () => {
            vi.resetModules()

            vi.stubEnv(
                'RESEND_WEBHOOK_SECRET',
                'whsec_' +
                    Buffer.from('correct_secret', 'utf8').toString('base64')
            )

            const body = '{"type":"email.bounced"}'
            const messageId = 'msg_test'
            const timestamp = String(Math.floor(Date.now() / 1000))

            // Create signature with different secret
            const wrongSecret = Buffer.from('wrong_secret', 'utf8').toString(
                'base64'
            )
            const wrongSig = crypto
                .createHmac('sha256', Buffer.from(wrongSecret, 'base64'))
                .update(`${messageId}.${timestamp}.${body}`)
                .digest('base64')

            const resendWebhook = await import(
                '../netlify/lib/resend-webhook'
            )
            const result = resendWebhook.verifyResendSignature(body, {
                'svix-id': messageId,
                'svix-timestamp': timestamp,
                'svix-signature': `v1,${wrongSig}`
            })

            expect(result).toBe('invalid_signature')
        })
    })

    describe('AC7.3: Stale timestamp', () => {
        it('returns invalid_signature with old timestamp', async () => {
            vi.resetModules()

            const secret = 'whsec_' +
                Buffer.from('test_secret', 'utf8').toString('base64')
            vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)

            const body = '{"type":"email.bounced"}'
            const messageId = 'msg_test'
            // 1 hour ago
            const staleTimestamp = String(
                Math.floor(Date.now() / 1000) - 3600
            )

            const sig = crypto
                .createHmac(
                    'sha256',
                    Buffer.from('test_secret', 'utf8')
                )
                .update(`${messageId}.${staleTimestamp}.${body}`)
                .digest('base64')

            const resendWebhook = await import(
                '../netlify/lib/resend-webhook'
            )
            const result = resendWebhook.verifyResendSignature(body, {
                'svix-id': messageId,
                'svix-timestamp': staleTimestamp,
                'svix-signature': `v1,${sig}`
            })

            expect(result).toBe('invalid_signature')
        })
    })

    describe('AC7.4 + happy path: Valid signature', () => {
        it('returns null for valid signature and fresh timestamp',
            async () => {
                vi.resetModules()

                const secret = 'whsec_' +
                    Buffer.from('test_secret', 'utf8').toString('base64')
                vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)

                const body = '{"type":"email.bounced"}'
                const messageId = 'msg_test'
                const timestamp = String(Math.floor(Date.now() / 1000))

                const sig = crypto
                    .createHmac(
                        'sha256',
                        Buffer.from('test_secret', 'utf8')
                    )
                    .update(`${messageId}.${timestamp}.${body}`)
                    .digest('base64')

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                const result = resendWebhook.verifyResendSignature(
                    body,
                    {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                )

                expect(result).toBe(null)
            }
        )
    })

    describe('AC8.1 + AC8.2: Audit trail', () => {
        it(
            'calls refundPostcardBounce with correct postcard ID',
            async () => {
                vi.resetModules()

                const postcardId = crypto.randomUUID()
                const userId = crypto.randomUUID()
                const lotId = crypto.randomUUID()

                const refundPostcardBounce = vi
                    .fn()
                    .mockResolvedValue({
                        refunded: true,
                        balanceAfter: 5
                    })
                const getPostcardByResendEmailId = vi
                    .fn()
                    .mockResolvedValue({
                        id: postcardId,
                        sender_id: userId,
                        lot_id: lotId,
                        status: 'sent'
                    })

                vi.doMock('../netlify/lib/postcards.js', () => {
                    return {
                        getPostcardByResendEmailId,
                        refundPostcardBounce
                    }
                })

                const resendWebhook = await import(
                    '../netlify/lib/resend-webhook'
                )
                await resendWebhook.handleResendEvent({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_test123',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                expect(refundPostcardBounce).toHaveBeenCalledTimes(1)
                expect(refundPostcardBounce).toHaveBeenCalledWith(
                    postcardId
                )
            }
        )
    })
})
