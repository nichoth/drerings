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

const context = {} as HandlerContext

const transactionsEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/stamps/transactions',
    rawQuery: '',
    path: '/api/stamps/transactions',
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

describe('US-023 stamp transactions API', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns the newest page of stamp transactions with a cursor',
        async () => {
            vi.resetModules()

            const query = mockDatabase()

            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => activeSession() }
            })

            const { handler } = await import(
                '../netlify/functions/stamps-transactions'
            )
            const response = await callHandler(handler, transactionsEvent)

            const body = JSON.parse(response.body || '{}')

            expect(response.statusCode).toBe(200)
            expect(body.transactions).toHaveLength(50)
            expect(body.transactions.slice(0, 2)).toEqual([
                {
                    id: 'tx-0',
                    delta: 25,
                    reason: 'purchase',
                    balance_after: 25,
                    created_at: '2026-05-03T00:00:00.000Z'
                },
                {
                    id: 'tx-1',
                    delta: -1,
                    reason: 'send',
                    balance_after: 24,
                    created_at: '2026-05-02T00:00:00.000Z'
                }
            ])
            expect(body.next_before).toBe('2026-03-14T00:00:00.000Z')
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('FROM stamp_transactions'),
                ['user-1', null, 51]
            )
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY created_at DESC'),
                ['user-1', null, 51]
            )
        })
})

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

function mockDatabase ():ReturnType<typeof vi.fn<Query>> {
    const query = vi.fn<Query>(async () => {
        return {
            rows: transactionRows()
        }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { query }
            })
        }
    })

    return query
}

function transactionRows ():Array<Record<string, unknown>> {
    return Array.from({ length: 51 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 4, 3 - index))

        return {
            id: `tx-${index}`,
            delta: index === 0 ? 25 : index === 1 ? -1 : 5,
            reason: index === 0 ?
                'purchase' :
                index === 1 ?
                    'send' :
                    'grant',
            balance_after: index === 0 ? 25 : 24,
            created_at: date.toISOString()
        }
    })
}

function activeSession () {
    return {
        user: {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'test.bsky.social',
            stamps_balance: 24
        }
    }
}
