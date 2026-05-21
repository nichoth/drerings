import { describe, expect, it, vi } from 'vitest'
import type { Handler, HandlerResponse } from '@netlify/functions'

function assertResponse (
    r:Awaited<ReturnType<Handler>>
):asserts r is HandlerResponse {
    if (!r) throw new Error('handler returned void')
}

vi.mock('../netlify/lib/rate-limit.js')
vi.mock('../netlify/lib/session.js')
vi.mock('../netlify/lib/postcards.js')
vi.mock('../netlify/lib/shares.js')
vi.mock('../netlify/lib/billing.js')
vi.mock('../netlify/lib/posts.js')
vi.mock('@netlify/database')

describe('POST /api/postcards/send rate limiting', () => {
    it('under-limit: allows request when checkAndIncrement allows',
        async () => {
            const { checkAndIncrement } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: true,
                remaining: 29,
                resetAt: new Date(Date.now() + 60 * 1000)
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'test@example.com'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(mockCheckAndIncrement).toHaveBeenCalledWith(
                'user:user-123:postcards/send',
                30,
                60
            )
            expect(response.statusCode).not.toBe(429)
        }
    )

    it('over-limit: returns 429 when checkAndIncrement blocks',
        async () => {
            const { checkAndIncrement, rateLimitResponse } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)
            const mockRateLimitResponse = vi.mocked(rateLimitResponse)

            const now = Date.now()
            const resetAt = new Date(now + 30 * 1000)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: false,
                remaining: 0,
                resetAt
            })

            mockRateLimitResponse.mockReturnValueOnce({
                statusCode: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '30',
                    'RateLimit-Policy': '"default";q=30;w=60',
                    RateLimit: '"default";r=0;t=30'
                },
                body: JSON.stringify({ error: 'rate_limited' })
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'test@example.com'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(response.statusCode).toBe(429)
            expect(response.body).toBe(
                JSON.stringify({ error: 'rate_limited' })
            )
        }
    )
})

describe('POST /api/shares/confirm rate limiting', () => {
    it('under-limit: allows request when checkAndIncrement allows',
        async () => {
            const { checkAndIncrement } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: true,
                remaining: 29,
                resetAt: new Date(Date.now() + 60 * 1000)
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/shares-confirm.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    drawing_id: 'drawing-1',
                    timezone: 'UTC',
                    idempotency_key: 'idem-1'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(mockCheckAndIncrement).toHaveBeenCalledWith(
                'user:user-123:shares/confirm',
                30,
                60
            )
            expect(response.statusCode).not.toBe(429)
        }
    )

    it('over-limit: returns 429 when checkAndIncrement blocks',
        async () => {
            const { checkAndIncrement, rateLimitResponse } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)
            const mockRateLimitResponse = vi.mocked(rateLimitResponse)

            const now = Date.now()
            const resetAt = new Date(now + 30 * 1000)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: false,
                remaining: 0,
                resetAt
            })

            mockRateLimitResponse.mockReturnValueOnce({
                statusCode: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '30',
                    'RateLimit-Policy': '"default";q=30;w=60',
                    RateLimit: '"default";r=0;t=30'
                },
                body: JSON.stringify({ error: 'rate_limited' })
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/shares-confirm.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    drawing_id: 'drawing-1',
                    timezone: 'UTC',
                    idempotency_key: 'idem-1'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(response.statusCode).toBe(429)
            expect(response.body).toBe(
                JSON.stringify({ error: 'rate_limited' })
            )
        }
    )
})

describe('POST /api/billing/checkout rate limiting', () => {
    it('under-limit: allows request when checkAndIncrement allows',
        async () => {
            const { checkAndIncrement } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: true,
                remaining: 4,
                resetAt: new Date(Date.now() + 60 * 1000)
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/billing-checkout.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    product_id: '10_stamps'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(mockCheckAndIncrement).toHaveBeenCalledWith(
                'user:user-123:billing/checkout',
                5,
                60
            )
            expect(response.statusCode).not.toBe(429)
        }
    )

    it('over-limit: returns 429 when checkAndIncrement blocks',
        async () => {
            const { checkAndIncrement, rateLimitResponse } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)
            const mockRateLimitResponse = vi.mocked(rateLimitResponse)

            const now = Date.now()
            const resetAt = new Date(now + 30 * 1000)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: false,
                remaining: 0,
                resetAt
            })

            mockRateLimitResponse.mockReturnValueOnce({
                statusCode: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '30',
                    'RateLimit-Policy': '"default";q=5;w=60',
                    RateLimit: '"default";r=0;t=30'
                },
                body: JSON.stringify({ error: 'rate_limited' })
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/billing-checkout.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    product_id: '10_stamps'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(response.statusCode).toBe(429)
            expect(response.body).toBe(
                JSON.stringify({ error: 'rate_limited' })
            )
        }
    )
})

describe('POST /api/stamps/gifts/checkout rate limiting', () => {
    it('under-limit: allows request when checkAndIncrement allows',
        async () => {
            const { checkAndIncrement } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: true,
                remaining: 4,
                resetAt: new Date(Date.now() + 60 * 1000)
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    product_id: '10_stamps',
                    recipient: 'bob'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(mockCheckAndIncrement).toHaveBeenCalledWith(
                'user:user-123:stamps/gifts/checkout',
                5,
                60
            )
            expect(response.statusCode).not.toBe(429)
        }
    )

    it('over-limit: returns 429 when checkAndIncrement blocks',
        async () => {
            const { checkAndIncrement, rateLimitResponse } =
                await import('../netlify/lib/rate-limit.js')
            const { getSession } =
                await import('../netlify/lib/session.js')

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetSession = vi.mocked(getSession)
            const mockRateLimitResponse = vi.mocked(rateLimitResponse)

            const now = Date.now()
            const resetAt = new Date(now + 30 * 1000)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: false,
                remaining: 0,
                resetAt
            })

            mockRateLimitResponse.mockReturnValueOnce({
                statusCode: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '30',
                    'RateLimit-Policy': '"default";q=5;w=60',
                    RateLimit: '"default";r=0;t=30'
                },
                body: JSON.stringify({ error: 'rate_limited' })
            })

            mockGetSession.mockResolvedValueOnce({
                user: { id: 'user-123', did: 'did:123', handle: 'alice' }
            } as any)

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout.js'
            )

            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    product_id: '10_stamps',
                    recipient: 'bob'
                }),
                headers: {}
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(response.statusCode).toBe(429)
            expect(response.body).toBe(
                JSON.stringify({ error: 'rate_limited' })
            )
        }
    )
})
