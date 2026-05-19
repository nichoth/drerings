import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-039 credit stamp lot idempotency', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('creditStampLot', () => {
        it('credits stamps on first call', async () => {
            vi.resetModules()

            const clientQuery = vi.fn<Query>(async (sql, params) => {
                if (sql.includes('INSERT INTO stamp_lots')) {
                    return { rows: [{ id: 'lot-purchase-1' }] }
                }

                if (
                    sql.includes('UPDATE users') &&
                    params?.includes('user-1')
                ) {
                    return { rows: [{ stamps_balance: 10 }] }
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
                        pool: { connect }
                    })
                }
            })

            const { creditStampLot } = await import(
                '../netlify/lib/stamps.js'
            )
            const result = await creditStampLot({
                userId: 'user-1',
                source: 'purchase',
                count: 10,
                priceCents: 999,
                autumnCheckoutId: 'checkout-1'
            })

            expect(result).toEqual({
                lotId: 'lot-purchase-1',
                balanceAfter: 10
            })
            expect(clientQuery).toHaveBeenCalledWith('BEGIN')
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_lots'),
                [
                    'user-1',
                    'purchase',
                    10,
                    999,
                    'checkout-1',
                    undefined
                ]
            )
            expect(clientQuery).toHaveBeenCalledWith('COMMIT')
            expect(release).toHaveBeenCalled()
        })

        it('raises DuplicateStampCheckoutError on second call', async () => {
            vi.resetModules()

            const clientQuery = vi.fn<Query>(async (sql, _params) => {
                if (sql.includes('INSERT INTO stamp_lots')) {
                    const err:any = new Error('unique violation')
                    err.code = '23505'
                    throw err
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
                        pool: { connect }
                    })
                }
            })

            const { creditStampLot, DuplicateStampCheckoutError } =
                await import('../netlify/lib/stamps.js')

            await expect(
                creditStampLot({
                    userId: 'user-1',
                    source: 'purchase',
                    count: 10,
                    priceCents: 999,
                    autumnCheckoutId: 'checkout-duplicate'
                })
            ).rejects.toThrow(DuplicateStampCheckoutError)

            expect(clientQuery).toHaveBeenCalledWith('ROLLBACK')
            expect(release).toHaveBeenCalled()
        })

        it('resolves to one credit and one error on concurrent calls',
            async () => {
                vi.resetModules()

                let callCount = 0
                const clientQuery = vi.fn<Query>(async (sql, params) => {
                    if (sql.includes('INSERT INTO stamp_lots')) {
                        callCount++
                        if (callCount === 1) {
                            return { rows: [{ id: 'lot-concurrent-1' }] }
                        }
                        const err:any = new Error('unique violation')
                        err.code = '23505'
                        throw err
                    }

                    if (
                        sql.includes('UPDATE users') &&
                        params?.includes('user-concurrent')
                    ) {
                        return { rows: [{ stamps_balance: 10 }] }
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
                            pool: { connect }
                        })
                    }
                })

                const { creditStampLot, DuplicateStampCheckoutError } =
                    await import('../netlify/lib/stamps.js')

                const promise1 = creditStampLot({
                    userId: 'user-concurrent',
                    source: 'purchase',
                    count: 10,
                    priceCents: 999,
                    autumnCheckoutId: 'checkout-race'
                })

                const promise2 = creditStampLot({
                    userId: 'user-concurrent',
                    source: 'purchase',
                    count: 10,
                    priceCents: 999,
                    autumnCheckoutId: 'checkout-race'
                })

                const results = await Promise.allSettled([promise1, promise2])

                const fulfilled = results.filter(
                    (r) => r.status === 'fulfilled'
                )
                const rejected = results.filter(
                    (r) => r.status === 'rejected'
                )

                expect(fulfilled).toHaveLength(1)
                expect(rejected).toHaveLength(1)
                expect(fulfilled[0]).toEqual({
                    status: 'fulfilled',
                    value: {
                        lotId: 'lot-concurrent-1',
                        balanceAfter: 10
                    }
                })
                expect(rejected[0].status).toBe('rejected')
                if (rejected[0].status === 'rejected') {
                    expect(rejected[0].reason).toBeInstanceOf(
                        DuplicateStampCheckoutError
                    )
                }
            })
    })

    describe('creditGiftStampLot', () => {
        it('credits gift stamps on first call', async () => {
            vi.resetModules()

            const clientQuery = vi.fn<Query>(async (sql, params) => {
                if (sql.includes('INSERT INTO stamp_lots')) {
                    return { rows: [{ id: 'lot-gift-1' }] }
                }

                if (
                    sql.includes('UPDATE users') &&
                    params?.includes('recipient-1')
                ) {
                    return { rows: [{ stamps_balance: 25 }] }
                }

                if (
                    sql.includes('SELECT stamps_balance') &&
                    sql.includes('FROM users')
                ) {
                    return { rows: [{ stamps_balance: 0 }] }
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
                        pool: { connect }
                    })
                }
            })

            const { creditGiftStampLot } = await import(
                '../netlify/lib/stamps.js'
            )
            const result = await creditGiftStampLot({
                senderUserId: 'sender-1',
                recipientUserId: 'recipient-1',
                count: 25,
                priceCents: 1000,
                autumnCheckoutId: 'checkout-gift-1'
            })

            expect(result).toEqual({
                lotId: 'lot-gift-1',
                recipientBalanceAfter: 25,
                senderBalanceAfter: 0
            })
            expect(clientQuery).toHaveBeenCalledWith('BEGIN')
            expect(clientQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stamp_lots'),
                [
                    'recipient-1',
                    'gift_received',
                    25,
                    1000,
                    'checkout-gift-1',
                    'sender-1'
                ]
            )
            expect(clientQuery).toHaveBeenCalledWith('COMMIT')
            expect(release).toHaveBeenCalled()
        })

        it('raises DuplicateStampCheckoutError on duplicate gift',
            async () => {
                vi.resetModules()

                const clientQuery = vi.fn<Query>(async (sql, _params) => {
                    if (sql.includes('INSERT INTO stamp_lots')) {
                        const err:any = new Error('unique violation')
                        err.code = '23505'
                        throw err
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
                            pool: { connect }
                        })
                    }
                })

                const { creditGiftStampLot, DuplicateStampCheckoutError } =
                    await import('../netlify/lib/stamps.js')

                await expect(
                    creditGiftStampLot({
                        senderUserId: 'sender-1',
                        recipientUserId: 'recipient-1',
                        count: 25,
                        priceCents: 1000,
                        autumnCheckoutId: 'checkout-gift-dup'
                    })
                ).rejects.toThrow(DuplicateStampCheckoutError)

                expect(clientQuery).toHaveBeenCalledWith('ROLLBACK')
                expect(release).toHaveBeenCalled()
            })

        it('resolves to one gift credit and one error on concurrent gift calls',
            async () => {
                vi.resetModules()

                let callCount = 0
                const clientQuery = vi.fn<Query>(async (sql, params) => {
                    if (sql.includes('INSERT INTO stamp_lots')) {
                        callCount++
                        if (callCount === 1) {
                            return { rows: [{ id: 'lot-gift-race-1' }] }
                        }
                        const err:any = new Error('unique violation')
                        err.code = '23505'
                        throw err
                    }

                    if (
                        sql.includes('UPDATE users') &&
                        params?.includes('recipient-race')
                    ) {
                        return { rows: [{ stamps_balance: 25 }] }
                    }

                    if (
                        sql.includes('SELECT stamps_balance') &&
                        sql.includes('FROM users')
                    ) {
                        return { rows: [{ stamps_balance: 0 }] }
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
                            pool: { connect }
                        })
                    }
                })

                const { creditGiftStampLot, DuplicateStampCheckoutError } =
                    await import('../netlify/lib/stamps.js')

                const promise1 = creditGiftStampLot({
                    senderUserId: 'sender-race',
                    recipientUserId: 'recipient-race',
                    count: 25,
                    priceCents: 1000,
                    autumnCheckoutId: 'checkout-gift-race'
                })

                const promise2 = creditGiftStampLot({
                    senderUserId: 'sender-race',
                    recipientUserId: 'recipient-race',
                    count: 25,
                    priceCents: 1000,
                    autumnCheckoutId: 'checkout-gift-race'
                })

                const results = await Promise.allSettled([promise1, promise2])

                const fulfilled = results.filter(
                    (r) => r.status === 'fulfilled'
                )
                const rejected = results.filter(
                    (r) => r.status === 'rejected'
                )

                expect(fulfilled).toHaveLength(1)
                expect(rejected).toHaveLength(1)
                expect(fulfilled[0]).toEqual({
                    status: 'fulfilled',
                    value: {
                        lotId: 'lot-gift-race-1',
                        recipientBalanceAfter: 25,
                        senderBalanceAfter: 0
                    }
                })
                expect(rejected[0].status).toBe('rejected')
                if (rejected[0].status === 'rejected') {
                    expect(rejected[0].reason).toBeInstanceOf(
                        DuplicateStampCheckoutError
                    )
                }
            })
    })
})
