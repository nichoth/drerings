import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/auth/magic-link',
    rawQuery: '',
    path: '/api/auth/magic-link',
    httpMethod: 'POST',
    headers: {
        host: 'drerings.app'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false
}

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-004 magic-link API', () => {
    it('creates a one-time login token and sends the link', async () => {
        vi.resetModules()

        const createMagicLinkLogin = vi.fn(async () => {
            return {
                userId: 'user-1',
                token: 'token-1',
                expiresAt: new Date('2026-05-10T12:15:00.000Z')
            }
        })
        const sendMagicLinkEmail = vi.fn(async () => {})

        vi.doMock('../netlify/lib/auth-store', () => {
            return { createMagicLinkLogin }
        })
        vi.doMock('../netlify/lib/resend', () => {
            return { sendMagicLinkEmail }
        })

        const { handler } = await import(
            '../netlify/functions/auth/magic-link'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            body: JSON.stringify({
                email: '  USER@Example.COM '
            })
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({ ok: true })
        expect(createMagicLinkLogin).toHaveBeenCalledWith(
            'user@example.com'
        )
        expect(sendMagicLinkEmail).toHaveBeenCalledWith({
            email: 'user@example.com',
            loginUrl: 'https://drerings.app/api/auth/magic-link/callback' +
                '?token=token-1'
        })
    })

    it('rejects invalid magic-link request emails', async () => {
        vi.resetModules()

        const createMagicLinkLogin = vi.fn()
        const sendMagicLinkEmail = vi.fn()

        vi.doMock('../netlify/lib/auth-store', () => {
            return { createMagicLinkLogin }
        })
        vi.doMock('../netlify/lib/resend', () => {
            return { sendMagicLinkEmail }
        })

        const { handler } = await import(
            '../netlify/functions/auth/magic-link'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            body: JSON.stringify({ email: 'not-an-email' })
        })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/valid email/i)
        expect(createMagicLinkLogin).not.toHaveBeenCalled()
        expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('consumes a valid token and sets a session cookie', async () => {
        vi.resetModules()

        const consumeMagicLinkToken = vi.fn(async () => {
            return {
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'free'
            }
        })

        vi.doMock('../netlify/lib/auth-store', () => {
            return { consumeMagicLinkToken }
        })

        const { handler } = await import(
            '../netlify/functions/auth/magic-link-callback'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/auth/magic-link/callback' +
                '?token=token-1',
            path: '/api/auth/magic-link/callback',
            httpMethod: 'GET',
            queryStringParameters: { token: 'token-1' }
        })

        expect(response.statusCode).toBe(302)
        expect(response.headers?.Location).toBe('/')
        expect(response.headers?.['Set-Cookie'])
            .toMatch(/^drerings_session=/)
        expect(response.headers?.['Set-Cookie'])
            .toContain('HttpOnly')
        expect(response.headers?.['Set-Cookie'])
            .toContain('Secure')
        expect(response.headers?.['Set-Cookie'])
            .toContain('SameSite=Lax')
        expect(consumeMagicLinkToken).toHaveBeenCalledWith('token-1')
    })

    it('shows a clear error page for expired or reused tokens', async () => {
        vi.resetModules()

        const consumeMagicLinkToken = vi.fn(async () => null)

        vi.doMock('../netlify/lib/auth-store', () => {
            return { consumeMagicLinkToken }
        })

        const { handler } = await import(
            '../netlify/functions/auth/magic-link-callback'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/auth/magic-link/callback' +
                '?token=spent-token',
            path: '/api/auth/magic-link/callback',
            httpMethod: 'GET',
            queryStringParameters: { token: 'spent-token' }
        })

        expect(response.statusCode).toBe(400)
        expect(response.headers?.['Content-Type']).toContain('text/html')
        expect(response.body).toMatch(/expired or already used/i)
    })
})
