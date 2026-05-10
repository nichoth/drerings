import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-017 account API', () => {
    it('returns account details for the current user', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return {
                clearSessionCookie: () => 'drerings_session=; Max-Age=0',
                getSession: async () => ({ user: user() })
            }
        })
        vi.doMock('../netlify/lib/account', () => {
            return {
                getAccountDetails: async () => ({
                    id: 'user-1',
                    email: 'paid@example.com',
                    subscription_status: 'active',
                    subscription_current_period_end: '2026-06-01',
                    passkeys: [{
                        id: 'passkey-1',
                        created_at: '2026-05-01T00:00:00.000Z'
                    }]
                }),
                deleteAccountData: vi.fn()
            }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { cancelAutumnSubscription: vi.fn() }
        })

        const { handler } = await import('../netlify/functions/account')
        const response = await callHandler(handler, accountEvent('GET'))
        const body = JSON.parse(response.body || '{}')

        expect(response.statusCode).toBe(200)
        expect(body.email).toBe('paid@example.com')
        expect(body.passkeys).toHaveLength(1)
    })

    it('sends an email update confirmation link', async () => {
        vi.resetModules()

        const requestEmailUpdate = vi.fn(async () => {})

        vi.doMock('../netlify/lib/session', () => {
            return {
                clearSessionCookie: () => 'drerings_session=; Max-Age=0',
                getSession: async () => ({ user: user() })
            }
        })
        vi.doMock('../netlify/lib/account', () => {
            return { requestEmailUpdate }
        })

        const { handler } = await import('../netlify/functions/account/email')
        const response = await callHandler(handler, {
            ...accountEvent('POST', '/api/account/email'),
            body: JSON.stringify({ email: 'new@example.com' })
        })

        expect(response.statusCode).toBe(200)
        expect(requestEmailUpdate).toHaveBeenCalledWith(
            'user-1',
            'new@example.com',
            'https://drerings.app'
        )
    })

    it('deletes account data after canceling billing', async () => {
        vi.resetModules()

        const deleteAccountData = vi.fn(async () => {})
        const cancelAutumnSubscription = vi.fn(async () => null)

        vi.doMock('../netlify/lib/session', () => {
            return {
                clearSessionCookie: () => 'drerings_session=; Max-Age=0',
                getSession: async () => ({ user: user() })
            }
        })
        vi.doMock('../netlify/lib/account', () => {
            return {
                getAccountDetails: vi.fn(),
                deleteAccountData
            }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { cancelAutumnSubscription }
        })

        const { handler } = await import('../netlify/functions/account')
        const response = await callHandler(handler, accountEvent('DELETE'))

        expect(response.statusCode).toBe(200)
        expect(cancelAutumnSubscription).toHaveBeenCalledWith(user())
        expect(deleteAccountData).toHaveBeenCalledWith('user-1')
        expect(response.headers?.['Set-Cookie']).toContain('Max-Age=0')
    })

    it('requires a session for destructive account actions', async () => {
        vi.resetModules()

        const deleteAccountData = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/account', () => {
            return {
                getAccountDetails: vi.fn(),
                deleteAccountData
            }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { cancelAutumnSubscription: vi.fn() }
        })

        const { handler } = await import('../netlify/functions/account')
        const response = await callHandler(handler, accountEvent('DELETE'))

        expect(response.statusCode).toBe(401)
        expect(deleteAccountData).not.toHaveBeenCalled()
    })
})

function accountEvent (
    method:string,
    path = '/api/account'
):HandlerEvent {
    return {
        rawUrl: `https://drerings.app${path}`,
        rawQuery: '',
        path,
        httpMethod: method,
        headers: {
            host: 'drerings.app'
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false
    }
}

function user () {
    return {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active'
    }
}
