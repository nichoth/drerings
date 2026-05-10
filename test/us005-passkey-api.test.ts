import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import { createSessionCookie } from '../netlify/lib/session'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/auth/passkey/register/options',
    rawQuery: '',
    path: '/api/auth/passkey/register/options',
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
const sessionCookie = createSessionCookie({
    id: 'user-1',
    email: 'user@example.com',
    subscription_status: 'free'
})

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-005 passkey API', () => {
    const registerOptionsModule =
        '../netlify/functions/auth/passkey/register/options'
    const registerVerifyModule =
        '../netlify/functions/auth/passkey/register/verify'
    const loginOptionsModule =
        '../netlify/functions/auth/passkey/login/options'
    const loginVerifyModule =
        '../netlify/functions/auth/passkey/login/verify'

    it('requires a session before registration options', async () => {
        vi.resetModules()

        const { handler } = await import(registerOptionsModule)
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(401)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/sign in/i)
    })

    it('generates registration options for the signed-in user', async () => {
        vi.resetModules()

        const generatePasskeyRegistrationOptions = vi.fn(async () => {
            return {
                options: {
                    challenge: 'registration-challenge',
                    rp: { name: 'Drerings', id: 'drerings.app' },
                    user: {
                        id: 'user-1',
                        name: 'user@example.com',
                        displayName: 'user@example.com'
                    },
                    pubKeyCredParams: []
                },
                challengeToken: 'registration-token'
            }
        })

        vi.doMock('../netlify/lib/passkeys', () => {
            return { generatePasskeyRegistrationOptions }
        })

        const { handler } = await import(registerOptionsModule)
        const response = await callHandler(handler, {
            ...baseEvent,
            headers: {
                ...baseEvent.headers,
                cookie: sessionCookie
            }
        })
        const body = JSON.parse(response.body || '{}')

        expect(response.statusCode).toBe(200)
        expect(body.challenge_token).toBe('registration-token')
        expect(body.options.challenge).toBe('registration-challenge')
        expect(generatePasskeyRegistrationOptions).toHaveBeenCalledWith(
            {
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'free'
            },
            'https://drerings.app'
        )
    })

    it('verifies registration responses for the signed-in user', async () => {
        vi.resetModules()

        const verifyPasskeyRegistration = vi.fn(async () => true)

        vi.doMock('../netlify/lib/passkeys', () => {
            return { verifyPasskeyRegistration }
        })

        const { handler } = await import(registerVerifyModule)
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/auth/passkey/register/verify',
            path: '/api/auth/passkey/register/verify',
            headers: {
                ...baseEvent.headers,
                cookie: sessionCookie
            },
            body: JSON.stringify({
                challenge_token: 'registration-token',
                response: { id: 'credential-1' }
            })
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            verified: true
        })
        expect(verifyPasskeyRegistration).toHaveBeenCalledWith({
            user: {
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'free'
            },
            origin: 'https://drerings.app',
            challengeToken: 'registration-token',
            response: { id: 'credential-1' }
        })
    })

    it('generates login options without requiring a session', async () => {
        vi.resetModules()

        const generatePasskeyLoginOptions = vi.fn(async () => {
            return {
                options: {
                    challenge: 'login-challenge',
                    rpId: 'drerings.app'
                },
                challengeToken: 'login-token'
            }
        })

        vi.doMock('../netlify/lib/passkeys', () => {
            return { generatePasskeyLoginOptions }
        })

        const { handler } = await import(loginOptionsModule)
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/auth/passkey/login/options',
            path: '/api/auth/passkey/login/options'
        })
        const body = JSON.parse(response.body || '{}')

        expect(response.statusCode).toBe(200)
        expect(body.challenge_token).toBe('login-token')
        expect(body.options.challenge).toBe('login-challenge')
        expect(generatePasskeyLoginOptions)
            .toHaveBeenCalledWith('https://drerings.app')
    })

    it('verifies login responses and issues a session cookie', async () => {
        vi.resetModules()

        const verifyPasskeyLogin = vi.fn(async () => {
            return {
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'free'
            }
        })

        vi.doMock('../netlify/lib/passkeys', () => {
            return { verifyPasskeyLogin }
        })

        const { handler } = await import(loginVerifyModule)
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/auth/passkey/login/verify',
            path: '/api/auth/passkey/login/verify',
            body: JSON.stringify({
                challenge_token: 'login-token',
                response: { id: 'credential-1' }
            })
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            verified: true
        })
        expect(response.headers?.['Set-Cookie'])
            .toMatch(/^drerings_session=/)
    })
})
