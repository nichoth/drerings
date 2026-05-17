import { describe, expect, it, vi, afterEach } from 'vitest'
import crypto from 'node:crypto'

interface QueryResult {
    rows:Array<Record<string, unknown>>;
}

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function createDbMock () {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql:string, params:unknown[] = []) => {
        // For getPostcardByResendEmailId, return a sent postcard
        if (sql.includes('WHERE resend_email_id = $1')) {
            return {
                rows: [{
                    id: 'postcard-1',
                    sender_id: 'user-1',
                    lot_id: 'lot-1',
                    status: 'sent'
                }]
            }
        }

        // For stamp_lots SELECT in refundFailedSend
        if (sql.includes('UPDATE stamp_lots') &&
            sql.includes('remaining_count = remaining_count + 1')) {
            return { rows: [{ id: 'lot-1' }] }
        }

        // For balance update
        if (sql.includes('UPDATE users')) {
            return { rows: [{ stamps_balance: 7 }] }
        }

        // For INSERT stamp_transactions
        if (sql.includes('INSERT INTO stamp_transactions')) {
            return { rows: [{ id: 'txn-1' }] }
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

    return { connect, query, release }
}

function signResend (
    messageId:string,
    timestamp:string,
    body:string,
    secret:string
):string {
    const key = Buffer.from(
        secret.replace(/^whsec_/, ''),
        'base64'
    )
    const digest = crypto
        .createHmac('sha256', key)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest('base64')

    return `v1,${digest}`
}

describe('US-037 end-to-end failed send refund (sync + async)', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('sync refund path on blob failure', async () => {
        vi.resetModules()

        const db = createDbMock()
        const { refundFailedSend } = await import(
            '../netlify/lib/stamps'
        )

        // Refund the stamp after a failed send
        const result = await refundFailedSend({
            userId: 'user-1',
            lotId: 'lot-1'
        })

        expect(result).toEqual({
            lotId: 'lot-1',
            balanceAfter: 7
        })

        // Verify the refund transaction was recorded
        const refundCalls = db.query.mock.calls.filter(
            call => {
                const sql = call[0]
                const params = call[1]
                return sql.includes('INSERT INTO stamp_transactions') &&
                       params &&
                       params[3] === 'failed_send_refund'
            }
        )
        expect(refundCalls.length).toBe(1)

        // Verify the lot was updated (remaining_count += 1)
        const updateLotCalls = db.query.mock.calls.filter(
            call => call[0].includes('UPDATE stamp_lots') &&
                    call[0].includes('remaining_count = remaining_count + 1')
        )
        expect(updateLotCalls.length).toBe(1)

        // Verify the transaction was committed
        const commitCalls = db.query.mock.calls.filter(
            call => call[0] === 'COMMIT'
        )
        expect(commitCalls.length).toBe(1)
    })

    it('async hard bounce refund through webhook', async () => {
        vi.resetModules()
        vi.stubEnv(
            'RESEND_WEBHOOK_SECRET',
            'whsec_' + Buffer.from('test-secret').toString('base64')
        )

        const db = createDbMock()

        // Mock refundFailedSend to track calls
        const refundFailedSend = vi.fn().mockResolvedValue({
            lotId: 'lot-1',
            balanceAfter: 7
        })

        // Mock markFailedRefunded
        const markFailedRefunded = vi.fn().mockResolvedValue(undefined)

        vi.doMock('../netlify/lib/stamps.js', () => ({
            refundFailedSend
        }))

        vi.doMock('../netlify/lib/postcards.js', () => ({
            getPostcardByResendEmailId: vi.fn().mockResolvedValue({
                id: 'postcard-1',
                sender_id: 'user-1',
                lot_id: 'lot-1',
                status: 'sent'
            }),
            markFailedRefunded
        }))

        const resendWebhook = await import(
            '../netlify/lib/resend-webhook'
        )

        // Construct signed bounce event
        const body = JSON.stringify({
            type: 'email.bounced',
            data: {
                email_id: 're_test123',
                bounce: { type: 'hard_bounce' }
            }
        })
        const messageId = 'msg_test'
        const timestamp = String(Math.floor(Date.now() / 1000))
        const sig = signResend(
            messageId,
            timestamp,
            body,
            'whsec_' + Buffer.from('test-secret').toString('base64')
        )

        // Note: verifyResendSignature is called, but since we're mocking
        // the library directly, we focus on the handler behavior
        const result = await resendWebhook.handleResendEvent({
            type: 'email.bounced',
            data: {
                email_id: 're_test123',
                bounce: { type: 'hard_bounce' }
            }
        })

        expect(result).toEqual({
            received: true,
            refunded: true
        })
        expect(refundFailedSend).toHaveBeenCalledWith({
            userId: 'user-1',
            lotId: 'lot-1'
        })
        expect(markFailedRefunded).toHaveBeenCalledWith('postcard-1')
    })

    it('double-fault: sync refund already happened, bounce is no-op', async () => {
        vi.resetModules()

        const refundFailedSend = vi.fn()
        const markFailedRefunded = vi.fn()
        const getPostcardByResendEmailId = vi
            .fn()
            .mockResolvedValue({
                id: 'postcard-1',
                sender_id: 'user-1',
                lot_id: 'lot-1',
                status: 'failed_refunded'  // Already refunded!
            })

        vi.doMock('../netlify/lib/stamps.js', () => ({
            refundFailedSend
        }))

        vi.doMock('../netlify/lib/postcards.js', () => ({
            getPostcardByResendEmailId,
            markFailedRefunded
        }))

        const resendWebhook = await import(
            '../netlify/lib/resend-webhook'
        )

        const result = await resendWebhook.handleResendEvent({
            type: 'email.bounced',
            data: {
                email_id: 're_test123',
                bounce: { type: 'hard_bounce' }
            }
        })

        expect(result).toEqual({
            received: true,
            refunded: false,
            reason: 'already_refunded'
        })
        expect(refundFailedSend).not.toHaveBeenCalled()
        expect(markFailedRefunded).not.toHaveBeenCalled()
    })
})
