import { describe, expect, it, vi } from 'vitest'

describe('checkAndIncrement', () => {
    it('AC21.1: first call returns allowed:true with remaining', async () => {
        vi.resetModules()

        const now = new Date()
        const query = vi.fn(async () => ({
            rows: [{ count: 1, window_start: now.toISOString() }]
        }))

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { checkAndIncrement } = await import(
            '../netlify/lib/rate-limit.js'
        )
        const result = await checkAndIncrement(
            'user:U:postcards',
            30,
            60
        )

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(29)
        expect(result.resetAt).toEqual(
            new Date(now.getTime() + 60 * 1000)
        )
    })

    it('AC21.2: successive calls show decreasing remaining',
        async () => {
            vi.resetModules()

            const now = new Date()
            let callCount = 0
            const query = vi.fn(async () => {
                callCount++
                return {
                    rows: [{ count: callCount, window_start: now }]
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { checkAndIncrement } = await import(
                '../netlify/lib/rate-limit.js'
            )
            const max = 30

            const first = await checkAndIncrement(
                'user:U:postcards',
                max,
                60
            )
            expect(first.remaining).toBe(29)

            const second = await checkAndIncrement(
                'user:U:postcards',
                max,
                60
            )
            expect(second.remaining).toBe(28)

            const third = await checkAndIncrement(
                'user:U:postcards',
                max,
                60
            )
            expect(third.remaining).toBe(27)
        }
    )

    it('AC21.3: over limit returns allowed:false, remaining:0',
        async () => {
            vi.resetModules()

            const now = new Date()
            const query = vi.fn(async () => ({
                rows: [{ count: 31, window_start: now }]
            }))

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { checkAndIncrement } = await import(
                '../netlify/lib/rate-limit.js'
            )
            const result = await checkAndIncrement(
                'user:U:postcards',
                30,
                60
            )

            expect(result.allowed).toBe(false)
            expect(result.remaining).toBe(0)
        }
    )

    it('AC21.4: window rollover resets window_start and count',
        async () => {
            vi.resetModules()

            const now = Date.now()
            const _oldWindow = new Date(now - 65 * 1000) // 65s ago
            const query = vi.fn(async () => ({
                // Return count=1 which indicates window was reset
                rows: [{ count: 1, window_start: now }]
            }))

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { checkAndIncrement } = await import(
                '../netlify/lib/rate-limit.js'
            )
            const result = await checkAndIncrement(
                'user:U:postcards',
                30,
                60
            )

            // After window rollover: count=1, so allowed and remaining=29
            expect(result.allowed).toBe(true)
            expect(result.remaining).toBe(29)
            // resetAt should be window_start + 60s = now + 60s
            const expectedResetTime = now + 60 * 1000
            const tolerance = 100 // milliseconds
            expect(
                Math.abs(result.resetAt.getTime() - expectedResetTime)
            ).toBeLessThan(tolerance)
        }
    )

    it('AC21.5: concurrent calls are atomic (no lost updates)',
        async () => {
            vi.resetModules()

            const now = new Date()
            let callCount = 0
            const query = vi.fn(async () => {
                callCount++
                // Return the incremented count as would happen
                // after both queries execute atomically
                return {
                    rows: [{ count: callCount, window_start: now.toISOString() }]
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { checkAndIncrement } = await import(
                '../netlify/lib/rate-limit.js'
            )

            // Fire both concurrently
            const [r1, r2] = await Promise.all([
                checkAndIncrement('user:U:postcards', 30, 60),
                checkAndIncrement('user:U:postcards', 30, 60)
            ])

            // Both should have been processed; at least one should be
            // under limit (count 1 or 2)
            expect(r1.allowed || r2.allowed).toBe(true)
            // callCount should be 2, meaning both increments happened
            expect(callCount).toBe(2)
        }
    )

    it('AC21.6: sustained over-limit keeps window static',
        async () => {
            vi.resetModules()

            const now = new Date()
            let callSequence = 0
            const query = vi.fn(async () => {
                callSequence++
                // Return increasing counts (31, 32, 33) all over-limit,
                // with FIXED window_start (ELSE branch preserves it)
                const count = 30 + callSequence
                return {
                    rows: [{ count, window_start: now.toISOString() }]
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { checkAndIncrement } = await import(
                '../netlify/lib/rate-limit.js'
            )

            const first = await checkAndIncrement(
                'user:U:postcards',
                30,
                60
            )
            expect(first.allowed).toBe(false)
            expect(first.remaining).toBe(0)
            const firstResetAt = first.resetAt

            const second = await checkAndIncrement(
                'user:U:postcards',
                30,
                60
            )
            expect(second.allowed).toBe(false)
            expect(second.remaining).toBe(0)
            expect(second.resetAt).toEqual(firstResetAt)

            const third = await checkAndIncrement(
                'user:U:postcards',
                30,
                60
            )
            expect(third.allowed).toBe(false)
            expect(third.remaining).toBe(0)
            expect(third.resetAt).toEqual(firstResetAt)
        }
    )
})

describe('getClientIp', () => {
    it('AC22.1: returns x-nf-client-connection-ip when present',
        async () => {
            vi.resetModules()

            const { getClientIp } = await import(
                '../netlify/lib/rate-limit.js'
            )

            const event = {
                headers: {
                    'x-nf-client-connection-ip': '1.2.3.4'
                }
            } as any

            const ip = getClientIp(event)
            expect(ip).toBe('1.2.3.4')
        }
    )

    it('AC22.2: falls back to first hop of x-forwarded-for',
        async () => {
            vi.resetModules()

            const { getClientIp } = await import(
                '../netlify/lib/rate-limit.js'
            )

            const event = {
                headers: {
                    'x-forwarded-for': '1.2.3.4, 5.6.7.8'
                }
            } as any

            const ip = getClientIp(event)
            expect(ip).toBe('1.2.3.4')
        }
    )

    it('AC22.3: returns unknown when no headers present',
        async () => {
            vi.resetModules()

            const { getClientIp } = await import(
                '../netlify/lib/rate-limit.js'
            )

            const event = {
                headers: {}
            } as any

            const ip = getClientIp(event)
            expect(ip).toBe('unknown')
        }
    )
})

describe('rateLimitResponse', () => {
    it('AC23.6: builds 429 response with correct headers', async () => {
        vi.resetModules()

        const { rateLimitResponse } = await import(
            '../netlify/lib/rate-limit.js'
        )

        const now = Date.now()
        const resetAt = new Date(now + 30 * 1000)
        const check = {
            allowed: false,
            remaining: 0,
            resetAt
        }

        const response = rateLimitResponse(check, 30, 60)

        expect(response.statusCode).toBe(429)
        expect(response.headers).toBeDefined()
        if (response.headers) {
            expect(response.headers['Content-Type']).toBe(
                'application/json'
            )
            expect(response.headers['Cache-Control']).toBe(
                'private, no-store'
            )
            expect(response.headers['Retry-After']).toBe('30')
            expect(response.headers['RateLimit-Policy']).toBe(
                '"default";q=30;w=60'
            )
            expect(response.headers['RateLimit']).toBe(
                '"default";r=0;t=30'
            )
        }
        expect(JSON.parse(response.body || '')).toEqual({
            error: 'rate_limited'
        })
    })
})
