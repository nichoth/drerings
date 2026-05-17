import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

const parseBody = (r:unknown):unknown =>
    JSON.parse((r as {body:string}).body)

describe('US-033 Resend webhook handler function', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    describe('AC7.4: Wrong method', () => {
        it('GET request returns 405 method_not_allowed', async () => {
            vi.resetModules()

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const event = {
                httpMethod: 'GET',
                body: '',
                isBase64Encoded: false,
                headers: {}
            } as unknown

            const response = await handler(event as any, {} as any)

            expect(response?.statusCode).toBe(405)
            expect(parseBody(response)).toEqual({
                error: 'method_not_allowed'
            })
        })

        it('PUT request returns 405 method_not_allowed', async () => {
            vi.resetModules()

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const event = {
                httpMethod: 'PUT',
                body: '',
                isBase64Encoded: false,
                headers: {}
            } as unknown

            const response = await handler(event as any, {} as any)

            expect(response?.statusCode).toBe(405)
            expect(parseBody(response)).toEqual({
                error: 'method_not_allowed'
            })
        })

        it('DELETE request returns 405 method_not_allowed', async () => {
            vi.resetModules()

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const event = {
                httpMethod: 'DELETE',
                body: '',
                isBase64Encoded: false,
                headers: {}
            } as unknown

            const response = await handler(event as any, {} as any)

            expect(response?.statusCode).toBe(405)
            expect(parseBody(response)).toEqual({
                error: 'method_not_allowed'
            })
        })
    })

    describe('AC7.1: Missing signature headers', () => {
        it('POST without svix headers returns 400 invalid_signature',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = JSON.stringify({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {}
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(400)
                expect(parseBody(response)).toEqual({
                    error: 'invalid_signature'
                })
            }
        )

        it('POST without svix-id header returns 400', async () => {
            vi.resetModules()
            vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const body = JSON.stringify({
                type: 'email.bounced',
                data: {
                    email_id: 're_1',
                    bounce: { type: 'hard_bounce' }
                }
            })

            const event = {
                httpMethod: 'POST',
                body,
                isBase64Encoded: false,
                headers: {
                    'svix-timestamp': '1234567890',
                    'svix-signature': 'v1,invalid'
                }
            } as unknown

            const response = await handler(event as any, {} as any)

            expect(response?.statusCode).toBe(400)
            expect(parseBody(response)).toEqual({
                error: 'invalid_signature'
            })
        })
    })

    describe('AC7.2/7.3: Bad/stale signature', () => {
        it('POST with wrong signature returns 400 invalid_signature',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = JSON.stringify({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                const messageId = 'msg_test'
                const timestamp = String(
                    Math.floor(Date.now() / 1000)
                )

                // Compute signature with DIFFERENT secret
                const wrongSecret = 'whsec_wrong'
                const sig = crypto
                    .createHmac('sha256',
                        Buffer.from(wrongSecret.replace(/^whsec_/,
                            ''), 'base64'))
                    .update(messageId + '.' + timestamp + '.' + body)
                    .digest('base64')

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(400)
                expect(parseBody(response)).toEqual({
                    error: 'invalid_signature'
                })
            }
        )

        it('POST with stale timestamp returns 400 invalid_signature',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = JSON.stringify({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                const messageId = 'msg_test'
                // Timestamp 1 hour ago
                const timestamp = String(
                    Math.floor(Date.now() / 1000) - 3600
                )

                // Compute correct signature for this old timestamp
                const secret = 'whsec_test'
                const sig = crypto
                    .createHmac('sha256',
                        Buffer.from(secret.replace(/^whsec_/, ''),
                            'base64'))
                    .update(messageId + '.' + timestamp + '.' + body)
                    .digest('base64')

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(400)
                expect(parseBody(response)).toEqual({
                    error: 'invalid_signature'
                })
            }
        )
    })

    describe('Happy path: Valid signature and hard bounce', () => {
        it('Valid signature with hard bounce refunds stamp',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const handleResendEvent = vi.fn().mockResolvedValue({
                    received: true,
                    refunded: true
                })

                vi.doMock(
                    '../netlify/lib/resend-webhook.js',
                    () => ({
                        handleResendEvent,
                        verifyResendSignature: () => null
                    })
                )

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = JSON.stringify({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                const messageId = 'msg_test'
                const timestamp = String(
                    Math.floor(Date.now() / 1000)
                )

                // Compute correct signature
                const secret = 'whsec_test'
                const sig = crypto
                    .createHmac('sha256',
                        Buffer.from(secret.replace(/^whsec_/, ''),
                            'base64'))
                    .update(messageId + '.' + timestamp + '.' + body)
                    .digest('base64')

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(200)
                expect(parseBody(response)).toEqual({
                    received: true,
                    refunded: true
                })
                expect(handleResendEvent).toHaveBeenCalledWith({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })
            }
        )
    })

    describe('Non-JSON body', () => {
        it('POST with non-JSON body returns 400 invalid_payload',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = 'not json'
                const messageId = 'msg_test'
                const timestamp = String(
                    Math.floor(Date.now() / 1000)
                )

                // Compute signature for non-JSON body
                const secret = 'whsec_test'
                const sig = crypto
                    .createHmac('sha256',
                        Buffer.from(secret.replace(/^whsec_/, ''),
                            'base64'))
                    .update(messageId + '.' + timestamp + '.' + body)
                    .digest('base64')

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(400)
                expect(parseBody(response)).toEqual({
                    error: 'invalid_payload'
                })
            }
        )
    })

    describe('Internal exception', () => {
        it('handleResendEvent throw returns 500 webhook_processing_failed',
            async () => {
                vi.resetModules()
                vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')

                const handleResendEvent = vi.fn()
                    .mockRejectedValue(new Error('db error'))

                vi.doMock(
                    '../netlify/lib/resend-webhook.js',
                    () => ({
                        handleResendEvent,
                        verifyResendSignature: () => null
                    })
                )

                const { handler } = await import(
                    '../netlify/functions/webhooks/resend.js'
                )

                const body = JSON.stringify({
                    type: 'email.bounced',
                    data: {
                        email_id: 're_1',
                        bounce: { type: 'hard_bounce' }
                    }
                })

                const messageId = 'msg_test'
                const timestamp = String(
                    Math.floor(Date.now() / 1000)
                )

                const secret = 'whsec_test'
                const sig = crypto
                    .createHmac('sha256',
                        Buffer.from(secret.replace(/^whsec_/, ''),
                            'base64'))
                    .update(messageId + '.' + timestamp + '.' + body)
                    .digest('base64')

                const event = {
                    httpMethod: 'POST',
                    body,
                    isBase64Encoded: false,
                    headers: {
                        'svix-id': messageId,
                        'svix-timestamp': timestamp,
                        'svix-signature': `v1,${sig}`
                    }
                } as unknown

                const response = await handler(event as any, {} as any)

                expect(response?.statusCode).toBe(500)
                expect(parseBody(response)).toEqual({
                    error: 'webhook_processing_failed'
                })
            }
        )
    })
})
