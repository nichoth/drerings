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

const event = {
    rawUrl: 'https://drerings.app/.netlify/functions/verify-stamp-invariants',
    rawQuery: '',
    path: '/.netlify/functions/verify-stamp-invariants',
    httpMethod: 'POST',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false
} satisfies HandlerEvent

const context = {} as HandlerContext

describe('US-025 stamp invariant verification', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('logs cache and transaction drift without reconciling balances',
        async () => {
            vi.resetModules()

            const consoleError = vi.spyOn(console, 'error')
                .mockImplementation(() => undefined)
            const query = vi.fn<Query>(async () => {
                return {
                    rows: [{
                        user_id: 'balanced-user',
                        cached_balance: 5,
                        lot_balance: 5,
                        transaction_balance: 5
                    }, {
                        user_id: 'lot-drift-user',
                        cached_balance: 5,
                        lot_balance: 4,
                        transaction_balance: 5
                    }, {
                        user_id: 'tx-drift-user',
                        cached_balance: 8,
                        lot_balance: 8,
                        transaction_balance: 7
                    }]
                }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const { verifyStampInvariants } = await import(
                '../netlify/lib/stamps'
            )
            const result = await verifyStampInvariants()

            expect(result).toEqual({
                usersChecked: 3,
                driftCount: 2,
                drifts: [{
                    userId: 'lot-drift-user',
                    invariant: 'lot_balance',
                    expected: 4,
                    actual: 5
                }, {
                    userId: 'tx-drift-user',
                    invariant: 'transaction_balance',
                    expected: 7,
                    actual: 8
                }]
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('FROM users'),
                []
            )
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('SUM(remaining_count)'),
                []
            )
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('SUM(delta)'),
                []
            )
            expect(query).not.toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users'),
                expect.anything()
            )
            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant drift detected.',
                expect.objectContaining({
                    user_id: 'lot-drift-user',
                    expected: 4,
                    actual: 5
                })
            )
            expect(consoleError).toHaveBeenCalledWith(
                'Stamp invariant verification alert.',
                expect.objectContaining({
                    driftCount: 2
                })
            )
        })

    it('runs from a daily scheduled Netlify function', async () => {
        vi.resetModules()

        vi.spyOn(console, 'log').mockImplementation(() => undefined)

        const verifyStampInvariants = vi.fn(async () => {
            return {
                usersChecked: 4,
                driftCount: 0,
                drifts: []
            }
        })

        const schedule = vi.fn((cron:string, handler:Handler) => {
            return handler
        })

        vi.doMock('@netlify/functions', () => ({
            schedule
        }))
        vi.doMock('../netlify/lib/stamps.js', () => ({
            verifyStampInvariants
        }))

        const modulePath = '../netlify/functions/verify-stamp-invariants'
        const { handler } = await import(modulePath)
        const response = await callHandler(handler)

        expect(schedule).toHaveBeenCalledWith(
            '30 9 * * *',
            expect.any(Function)
        )
        expect(verifyStampInvariants).toHaveBeenCalledOnce()
        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            usersChecked: 4,
            driftCount: 0,
            drifts: []
        })
    })
})

async function callHandler (
    handler:Handler
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}
