import {
    describe, expect, it, beforeEach, afterEach, vi
} from 'vitest'

type QueryRow = Record<string, unknown>
type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:QueryRow[]; rowCount?:number }>

type UpsertRow = {
    id:string;
    status:'attempted'|'succeeded'|'failed';
    http_status:number|null;
    response_body:string|null;
    attempted_at:string;
    just_inserted:boolean;
}

type QueryMock = ReturnType<typeof vi.fn<Query>>

function installDbMock (queryFn:QueryMock):void {
    vi.doMock('@netlify/database', () => ({
        getDatabase: () => ({
            pool: {
                query: queryFn,
                connect: vi.fn(async () => ({
                    query: queryFn,
                    release: vi.fn()
                }))
            }
        })
    }))
}

function makeQueryWithUpsert (
    upsertRow:UpsertRow,
    options:{
        otherRows?:(sql:string, params?:unknown[]) =>
            { rows:QueryRow[] }|null;
    } = {}
):QueryMock {
    return vi.fn<Query>(async (sql:string, params?:unknown[]) => {
        if (sql.includes('INSERT INTO autumn_refund_attempts')) {
            return { rows: [upsertRow as QueryRow] }
        }
        if (sql.includes('UPDATE autumn_refund_attempts')) {
            return { rows: [] }
        }
        if (options.otherRows) {
            const out = options.otherRows(sql, params)
            if (out) return out
        }
        return { rows: [] }
    })
}

function jsonResponse (status:number, body:unknown):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    })
}

describe('US-039 issueAutumnStampRefund attempt logging', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.resetModules()
        // Disable mock-mode so the real path runs.
        vi.stubEnv('AUTUMN_SECRET_KEY', 'sk_test_autumn')
        vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    it('AC15.1 INSERT happens before fetch', async () => {
        let insertCount = 0
        const queryFn = vi.fn<Query>(async (sql:string) => {
            if (sql.includes('INSERT INTO autumn_refund_attempts')) {
                insertCount += 1
                return {
                    rows: [{
                        id: 'attempt-1',
                        status: 'attempted',
                        http_status: null,
                        response_body: null,
                        attempted_at: new Date().toISOString(),
                        just_inserted: true
                    }]
                }
            }
            return { rows: [] }
        })

        let resolveFetch:(value:Response) => void = () => undefined
        const fetchPromise = new Promise<Response>((resolve) => {
            resolveFetch = resolve
        })
        const fetchFn = vi.fn(() => fetchPromise)
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        const pending = issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        // Wait until INSERT has been observed (without resolving fetch).
        await vi.waitFor(() => {
            expect(insertCount).toBe(1)
        })

        // Fetch must not have completed yet because we haven't resolved it,
        // but INSERT already executed. That proves INSERT precedes the
        // network call.
        expect(fetchFn).toHaveBeenCalledTimes(1)
        const sqlsBeforeResolve = queryFn.mock.calls.map(
            (call) => call[0] as string
        )
        expect(sqlsBeforeResolve[0]).toMatch(
            /INSERT INTO autumn_refund_attempts/
        )

        resolveFetch(jsonResponse(200, { id: 'refund_1' }))
        await pending
    })

    it('AC15.2 success transitions to succeeded', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-2',
            status: 'attempted',
            http_status: null,
            response_body: null,
            attempted_at: new Date().toISOString(),
            just_inserted: true
        })

        const fetchFn = vi.fn(async () => jsonResponse(200, {
            id: 'refund_ok'
        }))
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        const updates = queryFn.mock.calls.filter((call) => {
            const sql = call[0] as string
            return sql.includes('UPDATE autumn_refund_attempts')
        })
        expect(updates.length).toBe(1)
        const updateSql = updates[0][0] as string
        expect(updateSql).toMatch(/status = 'succeeded'/)
        // Params: [attemptId, httpStatus, body]
        expect(updates[0][1]).toEqual([
            'attempt-2',
            200,
            expect.any(String)
        ])
        expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('AC15.3 HTTP failure transitions to failed', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-3',
            status: 'attempted',
            http_status: null,
            response_body: null,
            attempted_at: new Date().toISOString(),
            just_inserted: true
        })

        const fetchFn = vi.fn(async () => jsonResponse(502, {
            error: 'upstream'
        }))
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await expect(
            issueAutumnStampRefund({
                checkoutId: 'co_test',
                amountCents: 500
            })
        ).rejects.toThrow(/Autumn refund failed/)

        const updates = queryFn.mock.calls.filter((call) => {
            const sql = call[0] as string
            return sql.includes('UPDATE autumn_refund_attempts')
        })
        expect(updates.length).toBe(1)
        const updateSql = updates[0][0] as string
        expect(updateSql).toMatch(/status = 'failed'/)
        // Params: [attemptId, httpStatus, body, errorMessage]
        expect(updates[0][1]?.[0]).toBe('attempt-3')
        expect(updates[0][1]?.[1]).toBe(502)
    })

    it('AC15.4 network error transitions to failed', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-4',
            status: 'attempted',
            http_status: null,
            response_body: null,
            attempted_at: new Date().toISOString(),
            just_inserted: true
        })

        const fetchFn = vi.fn(async () => {
            throw new Error('socket hangup')
        })
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await expect(
            issueAutumnStampRefund({
                checkoutId: 'co_test',
                amountCents: 500
            })
        ).rejects.toThrow(/socket hangup/)

        const updates = queryFn.mock.calls.filter((call) => {
            const sql = call[0] as string
            return sql.includes('UPDATE autumn_refund_attempts')
        })
        expect(updates.length).toBe(1)
        const updateSql = updates[0][0] as string
        expect(updateSql).toMatch(/status = 'failed'/)
        // Network error => http_status null, error_message populated
        expect(updates[0][1]).toEqual([
            'attempt-4',
            null,
            null,
            'socket hangup'
        ])
    })

    it('AC15.5 prior=succeeded skips fetch', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-5',
            status: 'succeeded',
            http_status: 200,
            response_body: '{}',
            attempted_at: new Date(Date.now() - 5_000).toISOString(),
            just_inserted: false
        })

        const fetchFn = vi.fn()
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        expect(fetchFn).not.toHaveBeenCalled()
        const updates = queryFn.mock.calls.filter((call) => {
            const sql = call[0] as string
            return sql.includes('UPDATE autumn_refund_attempts')
        })
        expect(updates.length).toBe(0)
    })

    it(
        'AC15.5 prior=attempted <60s throws InFlightRefundAttemptError',
        async () => {
            const queryFn = makeQueryWithUpsert({
                id: 'attempt-6',
                status: 'attempted',
                http_status: null,
                response_body: null,
                attempted_at: new Date(
                    Date.now() - 5_000
                ).toISOString(),
                just_inserted: false
            })

            const fetchFn = vi.fn()
            vi.stubGlobal('fetch', fetchFn)

            installDbMock(queryFn)

            const {
                issueAutumnStampRefund,
                InFlightRefundAttemptError
            } = await import('../netlify/lib/billing.js')

            await expect(
                issueAutumnStampRefund({
                    checkoutId: 'co_test',
                    amountCents: 500
                })
            ).rejects.toBeInstanceOf(InFlightRefundAttemptError)

            expect(fetchFn).not.toHaveBeenCalled()
        }
    )

    it(
        'AC15.5 prior=attempted >=60s throws OrphanedRefundAttemptError',
        async () => {
            const queryFn = makeQueryWithUpsert({
                id: 'attempt-7',
                status: 'attempted',
                http_status: null,
                response_body: null,
                attempted_at: new Date(
                    Date.now() - 120_000
                ).toISOString(),
                just_inserted: false
            })

            const fetchFn = vi.fn()
            vi.stubGlobal('fetch', fetchFn)

            installDbMock(queryFn)

            const {
                issueAutumnStampRefund,
                OrphanedRefundAttemptError
            } = await import('../netlify/lib/billing.js')

            await expect(
                issueAutumnStampRefund({
                    checkoutId: 'co_test',
                    amountCents: 500
                })
            ).rejects.toBeInstanceOf(OrphanedRefundAttemptError)

            expect(fetchFn).not.toHaveBeenCalled()
        }
    )

    it('AC15.5 prior=failed 4xx retries via fetch', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-8',
            status: 'failed',
            http_status: 422,
            response_body: '{"error":"bad"}',
            attempted_at: new Date(Date.now() - 90_000).toISOString(),
            just_inserted: false
        })

        const fetchFn = vi.fn(async () => jsonResponse(200, {
            id: 'refund_retry_ok'
        }))
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        expect(fetchFn).toHaveBeenCalledTimes(1)

        // Should have RESET row to 'attempted' first, then UPDATEd to
        // 'succeeded' after success.
        const updateCalls = queryFn.mock.calls.filter((call) => {
            const sql = call[0] as string
            return sql.includes('UPDATE autumn_refund_attempts')
        })
        expect(updateCalls.length).toBe(2)
        expect(updateCalls[0][0]).toMatch(/status = 'attempted'/)
        expect(updateCalls[1][0]).toMatch(/status = 'succeeded'/)
    })

    it(
        'AC15.5 prior=failed 5xx throws AmbiguousRefundAttemptError',
        async () => {
            const queryFn = makeQueryWithUpsert({
                id: 'attempt-9',
                status: 'failed',
                http_status: 502,
                response_body: '{"error":"gateway"}',
                attempted_at: new Date(
                    Date.now() - 90_000
                ).toISOString(),
                just_inserted: false
            })

            const fetchFn = vi.fn()
            vi.stubGlobal('fetch', fetchFn)

            installDbMock(queryFn)

            const {
                issueAutumnStampRefund,
                AmbiguousRefundAttemptError
            } = await import('../netlify/lib/billing.js')

            await expect(
                issueAutumnStampRefund({
                    checkoutId: 'co_test',
                    amountCents: 500
                })
            ).rejects.toBeInstanceOf(AmbiguousRefundAttemptError)

            expect(fetchFn).not.toHaveBeenCalled()
        }
    )

    it(
        'AC15.5 prior=failed null http_status throws ambiguous',
        async () => {
            const queryFn = makeQueryWithUpsert({
                id: 'attempt-10',
                status: 'failed',
                http_status: null,
                response_body: null,
                attempted_at: new Date(
                    Date.now() - 90_000
                ).toISOString(),
                just_inserted: false
            })

            const fetchFn = vi.fn()
            vi.stubGlobal('fetch', fetchFn)

            installDbMock(queryFn)

            const {
                issueAutumnStampRefund,
                AmbiguousRefundAttemptError
            } = await import('../netlify/lib/billing.js')

            await expect(
                issueAutumnStampRefund({
                    checkoutId: 'co_test',
                    amountCents: 500
                })
            ).rejects.toBeInstanceOf(AmbiguousRefundAttemptError)

            expect(fetchFn).not.toHaveBeenCalled()
        }
    )

    it('AC15.6 uses pool.query, not pool.connect', async () => {
        const queryFn = makeQueryWithUpsert({
            id: 'attempt-11',
            status: 'attempted',
            http_status: null,
            response_body: null,
            attempted_at: new Date().toISOString(),
            just_inserted: true
        })
        const fetchFn = vi.fn(async () => jsonResponse(200, {
            id: 'refund_ok'
        }))
        vi.stubGlobal('fetch', fetchFn)

        const connect = vi.fn()
        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query: queryFn, connect }
            })
        }))

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        expect(connect).not.toHaveBeenCalled()
        expect(queryFn).toHaveBeenCalled()
    })

    it('AC15.7 mock mode bypasses pool.query and fetch', async () => {
        vi.unstubAllEnvs()
        vi.stubEnv('NODE_ENV', 'test')
        // No AUTUMN_SECRET_KEY => shouldUseMockCheckout() returns true

        const queryFn = vi.fn<Query>(async () => ({ rows: [] }))
        const fetchFn = vi.fn()
        vi.stubGlobal('fetch', fetchFn)

        installDbMock(queryFn)

        const { issueAutumnStampRefund } = await import(
            '../netlify/lib/billing.js'
        )

        await issueAutumnStampRefund({
            checkoutId: 'co_test',
            amountCents: 500
        })

        expect(queryFn).not.toHaveBeenCalled()
        expect(fetchFn).not.toHaveBeenCalled()
    })
})
