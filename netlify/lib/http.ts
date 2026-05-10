import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

export function json (
    statusCode:number,
    body:Record<string, unknown>
):HandlerResponse {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json'
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
