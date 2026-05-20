import { describe, expect, it, vi } from 'vitest'
import type { Handler, HandlerResponse } from '@netlify/functions'

function assertResponse (
    r:Awaited<ReturnType<Handler>>
):asserts r is HandlerResponse {
    if (!r) throw new Error('handler returned void')
}

vi.mock('../netlify/lib/rate-limit.js')
vi.mock('../netlify/lib/auth/atproto.js')
vi.mock('@netlify/database')

describe('POST /api/auth/login rate limiting', () => {
    it('under-limit: allows request when rate limit allows',
        async () => {
            const { checkAndIncrement, getClientIp } =
                await import('../netlify/lib/rate-limit.js')
            const { getOAuthClient } = await import(
                '../netlify/lib/auth/atproto.js'
            )

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetClientIp = vi.mocked(getClientIp)
            const mockGetOAuthClient = vi.mocked(getOAuthClient)

            mockCheckAndIncrement.mockResolvedValueOnce({
                allowed: true,
                remaining: 9,
                resetAt: new Date(Date.now() + 60 * 1000)
            })

            const authorizeUrl = new URL(
                'https://pds.example.com/authorize?code=xyz'
            )

            const mockClient = {
                authorize: vi.fn(async () => authorizeUrl)
            }

            mockGetOAuthClient.mockReturnValueOnce(mockClient as any)
            mockGetClientIp.mockReturnValueOnce('1.2.3.4')

            const { handler } = await import(
                '../netlify/functions/auth/login.js'
            )

            const event = {
                httpMethod: 'GET',
                queryStringParameters: { handle: 'alice.bsky.social' },
                headers: { 'x-nf-client-connection-ip': '1.2.3.4' }
            } as never

            const response = await handler(event, {} as never)

            assertResponse(response)
            expect(response.statusCode).toBe(302)
            expect(response.headers?.Location).toBe(
                authorizeUrl.toString()
            )
        }
    )

    it('over-limit: returns 429 when rate limit exceeded',
        async () => {
            const { checkAndIncrement, getClientIp, rateLimitResponse } =
                await import('../netlify/lib/rate-limit.js')
            const { getOAuthClient } = await import(
                '../netlify/lib/auth/atproto.js'
            )

            const mockCheckAndIncrement = vi.mocked(checkAndIncrement)
            const mockGetClientIp = vi.mocked(getClientIp)
            const mockRateLimitResponse = vi.mocked(rateLimitResponse)
            const mockGetOAuthClient = vi.mocked(getOAuthClient)

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
                    'RateLimit-Policy': '"default";q=10;w=60',
                    RateLimit: '"default";r=0;t=30'
                },
                body: JSON.stringify({ error: 'rate_limited' })
            })

            mockGetClientIp.mockReturnValueOnce('1.2.3.4')
            mockGetOAuthClient.mockReturnValueOnce({
                authorize: vi.fn()
            } as any)

            const { handler } = await import(
                '../netlify/functions/auth/login.js'
            )

            const event = {
                httpMethod: 'GET',
                queryStringParameters: { handle: 'alice.bsky.social' },
                headers: { 'x-nf-client-connection-ip': '1.2.3.4' }
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
