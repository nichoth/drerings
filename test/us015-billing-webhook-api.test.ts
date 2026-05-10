import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const secret = 'whsec_' + Buffer.from('test-secret').toString('base64')
const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

function eventForPayload (
    payload:Record<string, unknown>,
    signature = true
):HandlerEvent {
    const body = JSON.stringify(payload)
    const messageId = 'msg_123'
    const timestamp = Math.floor(Date.now() / 1000).toString()

    return {
        rawUrl: 'https://drerings.app/api/billing/webhook',
        rawQuery: '',
        path: '/api/billing/webhook',
        httpMethod: 'POST',
        headers: {
            host: 'drerings.app',
            'svix-id': messageId,
            'svix-timestamp': timestamp,
            'svix-signature': signature ?
                signSvix(messageId, timestamp, body) :
                'v1,invalid'
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body,
        isBase64Encoded: false
    }
}

function signSvix (
    messageId:string,
    timestamp:string,
    body:string
):string {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const digest = crypto
        .createHmac('sha256', key)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest('base64')

    return `v1,${digest}`
}

describe('US-015 billing webhook API', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('accepts a signed Autumn webhook and updates the user', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_WEBHOOK_SECRET', secret)

        const query = vi.fn<Query>(async () => {
            return { rows: [{ id: 'user-1' }] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { handler } = await import(
            '../netlify/functions/billing/webhook'
        )
        const response = await callHandler(handler, eventForPayload({
            type: 'subscription.created',
            data: {
                customer: {
                    id: 'autumn-user-1'
                }
            }
        }))

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            received: true,
            subscription_status: 'active'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users'),
            ['active', 'autumn-user-1', 'autumn-user-1']
        )
    })

    it('rejects a webhook with an invalid signature', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_WEBHOOK_SECRET', secret)

        const query = vi.fn<Query>(async () => ({ rows: [] }))

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { handler } = await import(
            '../netlify/functions/billing/webhook'
        )
        const response = await callHandler(handler, eventForPayload({
            type: 'subscription.created',
            data: {
                customer: {
                    id: 'autumn-user-1'
                }
            }
        }, false))

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body || '{}').error).toMatch(/signature/i)
        expect(query).not.toHaveBeenCalled()
    })

    it('rejects methods other than POST', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_WEBHOOK_SECRET', secret)

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query: vi.fn() }
                })
            }
        })

        const { handler } = await import(
            '../netlify/functions/billing/webhook'
        )
        const response = await callHandler(handler, {
            ...eventForPayload({ type: 'subscription.created' }),
            httpMethod: 'GET'
        })

        expect(response.statusCode).toBe(405)
    })
})
