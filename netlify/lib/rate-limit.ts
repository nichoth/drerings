import { getDatabase } from '@netlify/database'
import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

export interface RateLimitCheck {
    allowed:boolean;
    remaining:number;
    resetAt:Date;
}

interface RateLimitRow {
    count:number|string;
    window_start:string|Date;
}

/**
 * Atomic fixed-window token-bucket check.
 *
 * One round-trip: INSERT a fresh bucket OR (on conflict) reset-or-
 * increment the existing one in a single statement. Returns the
 * post-increment count plus the window's start so callers can derive
 * `resetAt`.
 *
 * The CASE expression in DO UPDATE handles window rollover atomically:
 * if `now() - window_start >= windowSeconds` the bucket resets to
 * count=1 and a fresh window_start; otherwise count is incremented.
 */
export async function checkAndIncrement (
    key:string,
    max:number,
    windowSeconds:number
):Promise<RateLimitCheck> {
    const db = getDatabase()
    const result = await db.pool.query<RateLimitRow>(`
        INSERT INTO rate_limit_buckets (key, window_start, count)
        VALUES ($1, now(), 1)
        ON CONFLICT (key) DO UPDATE
            SET count = CASE
                    WHEN EXTRACT(EPOCH FROM
                            (now() - rate_limit_buckets.window_start)
                        ) >= $2
                        THEN 1
                    ELSE rate_limit_buckets.count + 1
                END,
                window_start = CASE
                    WHEN EXTRACT(EPOCH FROM
                            (now() - rate_limit_buckets.window_start)
                        ) >= $2
                        THEN now()
                    ELSE rate_limit_buckets.window_start
                END
        RETURNING count, window_start
        -- PostgreSQL's now() is transaction_timestamp() — stable across all
        -- evaluations within a single statement. The two now() calls in this
        -- INSERT and the two in the ON CONFLICT CASE expressions all read the
        -- same instant. No race window inside this statement.
    `, [key, windowSeconds])

    const row = result.rows[0]
    const count = Number(row.count)
    const windowStart = new Date(row.window_start as string|Date)
    const resetAt = new Date(
        windowStart.getTime() + windowSeconds * 1000
    )
    const allowed = count <= max
    const remaining = Math.max(0, max - count)

    return { allowed, remaining, resetAt }
}

/**
 * Extract the request's client IP from Netlify-forwarded headers.
 * Prefers `x-nf-client-connection-ip` (Netlify-native, single value)
 * over `x-forwarded-for` (comma-separated chain — first hop wins).
 */
export function getClientIp (event:HandlerEvent):string {
    const headers = event.headers
    const netlifyIp = headers['x-nf-client-connection-ip']
    if (typeof netlifyIp === 'string' && netlifyIp.trim()) {
        return netlifyIp.trim()
    }

    const xff = headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.trim()) {
        const firstHop = xff.split(',')[0].trim()
        if (firstHop) return firstHop
    }

    return 'unknown'
}

/**
 * Build a 429 HandlerResponse. Includes Retry-After (seconds), the new
 * IETF-draft RateLimit / RateLimit-Policy structured-field headers, and
 * a small JSON body.
 *
 * See draft-ietf-httpapi-ratelimit-headers (2026-current).
 */
export function rateLimitResponse (
    check:RateLimitCheck,
    max:number,
    windowSeconds:number
):HandlerResponse {
    const secondsUntilReset = Math.max(
        0,
        Math.ceil((check.resetAt.getTime() - Date.now()) / 1000)
    )

    return {
        statusCode: 429,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
            'Retry-After': String(secondsUntilReset),
            'RateLimit-Policy': `"default";q=${max};w=${windowSeconds}`,
            RateLimit:
                `"default";r=${check.remaining};t=${secondsUntilReset}`
        },
        body: JSON.stringify({ error: 'rate_limited' })
    }
}
