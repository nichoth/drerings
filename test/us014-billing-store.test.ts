import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../netlify/lib/auth-store'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const user:SessionUser = {
    id: 'user-1',
    email: 'free@example.com',
    subscription_status: 'free'
}

describe('US-014 Autumn checkout store', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('creates an Autumn checkout and stores the customer id', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => ({ rows: [] }))
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                url: 'https://checkout.stripe.com/pay/cs_test_123',
                customer_id: 'autumn-user-1'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn_sk_test')
        vi.stubEnv('AUTUMN_PRODUCT_ID', 'drerings-paid')
        vi.stubGlobal('fetch', fetcher)
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const billing = await import('../netlify/lib/billing')
        const { createCheckoutSession } = billing
        const checkout = await createCheckoutSession(
            user,
            'https://drerings.app'
        )

        expect(checkout).toEqual({
            url: 'https://checkout.stripe.com/pay/cs_test_123',
            customer_id: 'autumn-user-1'
        })
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.useautumn.com/checkout',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer autumn_sk_test',
                    'content-type': 'application/json'
                }),
                body: JSON.stringify({
                    customer_id: 'user-1',
                    product_id: 'drerings-paid',
                    success_url: 'https://drerings.app/account?status=ok',
                    customer_data: {
                        email: 'free@example.com'
                    },
                    checkout_session_params: {
                        cancel_url:
                            'https://drerings.app/account?status=cancel'
                    }
                })
            })
        )
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users'),
            ['autumn-user-1', 'user-1']
        )
    })

    it('creates an Autumn checkout for a stamp pack product', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => ({ rows: [] }))
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                url: 'https://checkout.stripe.com/pay/stamps_bundle',
                customer_id: 'autumn-user-1'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn_sk_test')
        vi.stubGlobal('fetch', fetcher)
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const billing = await import('../netlify/lib/billing')
        const { createCheckoutSession } = billing
        const checkout = await createCheckoutSession(
            user,
            'https://drerings.app',
            'stamps_bundle'
        )

        expect(checkout).toEqual({
            url: 'https://checkout.stripe.com/pay/stamps_bundle',
            customer_id: 'autumn-user-1'
        })
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.useautumn.com/checkout',
            expect.objectContaining({
                body: JSON.stringify({
                    customer_id: 'user-1',
                    product_id: 'stamps_bundle',
                    success_url: 'https://drerings.app/account?status=ok',
                    customer_data: {
                        email: 'free@example.com'
                    },
                    checkout_session_params: {
                        cancel_url:
                            'https://drerings.app/account?status=cancel'
                    }
                })
            })
        )
    })

    it('returns a mocked checkout URL during local development', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => ({ rows: [] }))

        vi.stubEnv('NETLIFY_LOCAL', 'true')
        vi.stubGlobal('fetch', vi.fn())
        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const billing = await import('../netlify/lib/billing')
        const { createCheckoutSession } = billing
        const checkout = await createCheckoutSession(
            user,
            'http://localhost:8888'
        )

        expect(checkout).toEqual({
            url: 'http://localhost:8888/account?status=ok',
            customer_id: 'user-1'
        })
        expect(fetch).not.toHaveBeenCalled()
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users'),
            ['user-1', 'user-1']
        )
    })
})
