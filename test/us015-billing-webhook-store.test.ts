import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-015 Autumn webhook store', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it.each([
        ['subscription.created', 'active'],
        ['subscription.activated', 'active'],
        ['subscription.canceled', 'canceled'],
        ['subscription.payment_failed', 'past_due'],
        ['subscription.renewed', 'active']
    ])('maps %s to %s', async (type, subscriptionStatus) => {
        vi.resetModules()

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

        const billing = await import('../netlify/lib/billing')
        const result = await billing.applyAutumnWebhookEvent({
            type,
            data: {
                customer: {
                    id: 'autumn-user-1'
                }
            }
        })

        expect(result).toEqual({
            handled: true,
            subscription_status: subscriptionStatus
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users'),
            [subscriptionStatus, 'autumn-user-1', 'autumn-user-1']
        )
    })

    it('persists Autumn ids from product update events', async () => {
        vi.resetModules()

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

        const billing = await import('../netlify/lib/billing')
        const result = await billing.applyAutumnWebhookEvent({
            type: 'customer.products.updated',
            data: {
                scenario: 'new',
                customer: {
                    id: 'autumn-user-1'
                }
            }
        })

        expect(result).toEqual({
            handled: true,
            subscription_status: 'active'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('autumn_customer_id = $2'),
            ['active', 'autumn-user-1', 'autumn-user-1']
        )
    })

    it('ignores unsupported event types without a database write', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => ({ rows: [] }))

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const billing = await import('../netlify/lib/billing')
        const result = await billing.applyAutumnWebhookEvent({
            type: 'customer.threshold_reached',
            data: {
                customer: {
                    id: 'autumn-user-1'
                }
            }
        })

        expect(result).toEqual({ handled: false })
        expect(query).not.toHaveBeenCalled()
    })
})
