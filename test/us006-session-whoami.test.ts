import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import { createSessionCookie } from '../netlify/lib/session'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/whoami',
    rawQuery: '',
    path: '/api/whoami',
    httpMethod: 'GET',
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
    email: 'signed@example.com',
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

describe('US-006 session middleware and whoami API', () => {
    it('resolves the current user from the session cookie', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'user-1',
                    email: 'fresh@example.com',
                    subscription_status: 'active'
                }]
            }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { getSession } = await import('../netlify/lib/session')
        const session = await getSession({
            ...baseEvent,
            headers: {
                ...baseEvent.headers,
                cookie: sessionCookie
            }
        })

        expect(session).toEqual({
            user: {
                id: 'user-1',
                email: 'fresh@example.com',
                subscription_status: 'active'
            }
        })
        expect(query.mock.calls[0]![1]).toEqual(['user-1'])
        expect(query.mock.calls[0]![0]).toContain('FROM users')
    })

    it('returns null when the signed user no longer exists', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { getSession } = await import('../netlify/lib/session')
        const session = await getSession({
            ...baseEvent,
            headers: {
                ...baseEvent.headers,
                cookie: sessionCookie
            }
        })

        expect(session).toBeNull()
    })

    it('returns the current user from GET /api/whoami', async () => {
        vi.resetModules()

        const getSession = vi.fn(async () => {
            return {
                user: {
                    id: 'user-1',
                    email: 'user@example.com',
                    subscription_status: 'active'
                }
            }
        })

        vi.doMock('../netlify/lib/session', () => {
            return { getSession }
        })

        const { handler } = await import('../netlify/functions/whoami')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 'user-1',
            email: 'user@example.com',
            subscription_status: 'active'
        })
        expect(getSession).toHaveBeenCalledWith(baseEvent)
    })

    it('returns 401 from GET /api/whoami without a session', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return {
                getSession: async () => null
            }
        })

        const { handler } = await import('../netlify/functions/whoami')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(401)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/sign in/i)
    })
})
