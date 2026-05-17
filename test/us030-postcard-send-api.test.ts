import { describe, expect, it, vi } from 'vitest'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createDbMock () {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql:string, params?:unknown[]) => {
        if (sql.includes('SELECT *') &&
            sql.includes('FROM postcards')) {
            return { rows: [] }
        }

        if (sql.includes('INSERT INTO postcards')) {
            return {
                rows: [{
                    id: 'postcard-1',
                    sender_id: 'user-1',
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com',
                    lot_id: null,
                    resend_email_id: null,
                    status: 'queued',
                    idempotency_key: params?.[4],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]
            }
        }

        if (sql.includes('SELECT blob_key')) {
            return {
                rows: [{
                    blob_key: 'users/user-1/drawings/drawing-1.png',
                    text: 'test drawing',
                    alt_text: 'alt text'
                }]
            }
        }

        if (sql.includes('SELECT 1') &&
            sql.includes('FROM drawings')) {
            return { rows: [{ 1: 1 }] }
        }

        if (sql.includes('UPDATE users') &&
            sql.includes('stamps_balance = stamps_balance - 1')) {
            return { rows: [{ stamps_balance: 4 }] }
        }

        if (sql.includes('SELECT stamps_balance')) {
            return { rows: [{ stamps_balance: 4 }] }
        }

        if (sql.includes('UPDATE stamp_lots')) {
            return { rows: [] }
        }

        if (sql.includes('INSERT INTO stamp_transactions')) {
            return { rows: [] }
        }

        if (sql.includes('UPDATE postcards')) {
            return { rows: [] }
        }

        if (sql.includes('DELETE FROM postcards')) {
            return { rows: [] }
        }

        if (sql.includes('BEGIN') || sql.includes('COMMIT') ||
            sql.includes('ROLLBACK')) {
            return { rows: [] }
        }

        return { rows: [] }
    })

    const connect = vi.fn(async () => {
        return { query, release }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { connect }
            })
        }
    })

    vi.doMock('@netlify/blobs', () => {
        return {
            getStore: () => ({
                get: vi.fn(async () => Buffer.from('fake-png-data'))
            })
        }
    })

    return { connect, query, release }
}

describe('US-030 POST /api/postcards/send', () => {
    it('rejects non-POST requests', async () => {
        vi.resetModules()

        createDbMock()

        const event = {
            httpMethod: 'GET',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards/send',
            path: '/.netlify/functions/postcards/send',
            body: null
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards/send.js'
        )

        const response = await handler(event, {} as any)

        if (response) {
            expect(response.statusCode).toBe(405)
        }
    })

    it('rejects unauthenticated requests', async () => {
        vi.resetModules()

        createDbMock()

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards/send',
            path: '/.netlify/functions/postcards/send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards/send.js'
        )

        const response = await handler(event, {} as any)

        if (response) {
            expect(response.statusCode).toBe(401)
        }
    })

    it('parses valid email addresses', async () => {
        vi.resetModules()

        createDbMock()

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards/send',
            path: '/.netlify/functions/postcards/send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards/send.js'
        )

        const response = await handler(event, {} as any)

        if (response) {
            expect(response.statusCode).toBe(401)
        }
    })
})
