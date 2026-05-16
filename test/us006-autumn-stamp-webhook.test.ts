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
    params?:unknown[]
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

function eventForPayload (payload:Record<string, unknown>):HandlerEvent {
    const body = JSON.stringify(payload)
    const messageId = 'msg_stamps'
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
            'svix-signature': signSvix(messageId, timestamp, body)
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

describe('US-006 Autumn stamp purchase webhook', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('credits a signed checkout.completed stamp pack webhook', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_WEBHOOK_SECRET', secret)

        const query = vi.fn<Query>(async () => ({ rows: [] }))
        const clientQuery = vi.fn<Query>(async (sql) => {
            if (sql.includes('INSERT INTO stamp_lots')) {
                return { rows: [{ id: 'lot-1' }] }
            }

            if (sql.includes('UPDATE users')) {
                return { rows: [{ stamps_balance: 25 }] }
            }

            return { rows: [] }
        })
        const release = vi.fn()
        const connect = vi.fn(async () => {
            return { query: clientQuery, release }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query, connect }
                })
            }
        })

        const { handler } = await import(
            '../netlify/functions/billing/webhook'
        )
        const response = await callHandler(handler, eventForPayload({
            type: 'checkout.completed',
            data: {
                checkout_id: 'checkout-stamps-1',
                product_id: 'stamps_bundle',
                customer: {
                    id: 'user-1'
                }
            }
        }))

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            received: true,
            stamp_purchase: 'credited'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM stamp_transactions'),
            ['checkout-stamps-1']
        )
        expect(clientQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO stamp_lots'),
            [
                'user-1',
                'purchase',
                25,
                1000,
                'checkout-stamps-1',
                undefined
            ]
        )
        expect(clientQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO stamp_transactions'),
            [
                'user-1',
                'lot-1',
                25,
                'purchase',
                'checkout-stamps-1',
                25
            ]
        )
        expect(clientQuery).toHaveBeenCalledWith('COMMIT')
        expect(release).toHaveBeenCalled()
    })

    it('does not credit a checkout replay twice', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return { rows: [{ id: 'tx-1' }] }
        })
        const connect = vi.fn()

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query, connect }
                })
            }
        })

        const { applyAutumnWebhookEvent } = await import(
            '../netlify/lib/billing'
        )
        const result = await applyAutumnWebhookEvent({
            type: 'checkout.completed',
            data: {
                checkout_id: 'checkout-stamps-1',
                product_id: 'stamps_bundle',
                customer: {
                    id: 'user-1'
                }
            }
        })

        expect(result).toEqual({
            handled: true,
            stamp_purchase: 'already_credited'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM stamp_transactions'),
            ['checkout-stamps-1']
        )
        expect(connect).not.toHaveBeenCalled()
    })
})
