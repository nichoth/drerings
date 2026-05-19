import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

/**
 * Responds with a JSON body.
 * By default sets Cache-Control to 'private, no-store';
 * pass { cacheControl: '...' } to override.
 */
export function json (
    statusCode:number,
    body:Record<string, unknown>,
    options?:{ cacheControl?:string }
):HandlerResponse {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': options?.cacheControl ?? 'private, no-store'
        },
        body: JSON.stringify(body)
    }
}

export function getRequestOrigin (event:HandlerEvent):string {
    if (event.rawUrl) {
        return new URL(event.rawUrl).origin
    }

    const host = event.headers.host || event.headers.Host
    const proto = event.headers['x-forwarded-proto'] || 'https'

    return `${proto}://${host}`
}

export function parseJsonBody (
    event:HandlerEvent
):Record<string, unknown>|null {
    if (!event.body) return null

    try {
        return JSON.parse(event.body) as Record<string, unknown>
    } catch {
        return null
    }
}
