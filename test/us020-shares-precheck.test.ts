import { describe, expect, it, vi } from 'vitest'

describe('isValidIanaTimezone', () => {
    it('accepts well-known IANA names', async () => {
        const { isValidIanaTimezone } = await import(
            '../netlify/lib/shares'
        )

        expect(isValidIanaTimezone('America/New_York')).toBe(true)
        expect(isValidIanaTimezone('UTC')).toBe(true)
        expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true)
    })

    it('rejects invalid inputs', async () => {
        const { isValidIanaTimezone } = await import(
            '../netlify/lib/shares'
        )

        expect(isValidIanaTimezone('')).toBe(false)
        expect(isValidIanaTimezone('Not/A/Zone')).toBe(false)
    })
})

describe('monthKeyFor', () => {
    it('formats year-month using the supplied timezone', async () => {
        const { monthKeyFor } = await import('../netlify/lib/shares')

        const newYearsUTC = new Date('2026-01-01T00:30:00Z')
        // 30 min after midnight UTC = still 2025-12-31 in
        // America/New_York (UTC-5)
        expect(monthKeyFor('America/New_York', newYearsUTC))
            .toBe('2025-12')
        expect(monthKeyFor('UTC', newYearsUTC)).toBe('2026-01')
    })
})

describe('precheckShare', () => {
    it('returns free when user has no prior share this month',
        async () => {
            vi.resetModules()

            const query = vi.fn(async (sql:string, _params?:unknown[]) => {
                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key')) {
                    return { rows: [] } // no prior event
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    return { rows: [{ count: '0' }] } // no free used yet
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: { query } })
            }))

            const { precheckShare } = await import('../netlify/lib/shares')
            const result = await precheckShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })

            expect(result.type).toBe('free')
            if (result.type === 'free') {
                expect(result.month_key).toMatch(/^\d{4}-\d{2}$/)
            }
        }
    )

    it('returns paid when free is used but stamps available',
        async () => {
            vi.resetModules()

            const query = vi.fn(async (sql:string, _params?:unknown[]) => {
                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key')) {
                    return { rows: [] } // no prior event
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    return { rows: [{ count: '1' }] } // free used
                }
                if (sql.includes('stamps_balance')) {
                    return { rows: [{ stamps_balance: 5 }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: { query } })
            }))

            const { precheckShare } = await import('../netlify/lib/shares')
            const result = await precheckShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })

            expect(result.type).toBe('paid')
            if (result.type === 'paid') {
                expect(result.stamps_balance).toBe(5)
                expect(result.month_key).toMatch(/^\d{4}-\d{2}$/)
            }
        }
    )

    it('returns blocked when free is used and no stamps',
        async () => {
            vi.resetModules()

            const query = vi.fn(async (sql:string, _params?:unknown[]) => {
                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key')) {
                    return { rows: [] } // no prior event
                }
                if (sql.includes('count(*)')
                    && sql.includes('share_events')) {
                    return { rows: [{ count: '1' }] } // free used
                }
                if (sql.includes('stamps_balance')) {
                    return { rows: [{ stamps_balance: 0 }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: { query } })
            }))

            const { precheckShare } = await import('../netlify/lib/shares')
            const result = await precheckShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })

            expect(result.type).toBe('blocked')
            if (result.type === 'blocked') {
                expect(result.reason).toBe('no_free_no_stamps')
                expect(result.stamps_balance).toBe(0)
                expect(result.month_key).toMatch(/^\d{4}-\d{2}$/)
            }
        }
    )

    it('returns reused when idempotency_key found with same drawing_id',
        async () => {
            vi.resetModules()

            const query = vi.fn(async (sql:string, _params?:unknown[]) => {
                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key')) {
                    return {
                        rows: [{
                            drawing_id: 'drawing-1',
                            was_free: true
                        }]
                    } // prior event exists
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: { query } })
            }))

            const { precheckShare } = await import('../netlify/lib/shares')
            const result = await precheckShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })

            expect(result.type).toBe('reused')
            if (result.type === 'reused') {
                expect(result.was_free).toBe(true)
            }
        }
    )

    it('throws IdempotencyConflictError when idempotency_key used for different drawing',
        async () => {
            vi.resetModules()

            const query = vi.fn(async (sql:string, _params?:unknown[]) => {
                if (sql.includes('FROM share_events')
                    && sql.includes('idempotency_key')) {
                    return {
                        rows: [{
                            drawing_id: 'drawing-2',
                            was_free: true
                        }]
                    } // prior event for different drawing
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({ pool: { query } })
            }))

            const { precheckShare, IdempotencyConflictError } = await import(
                '../netlify/lib/shares'
            )

            await expect(precheckShare({
                userId: 'user-1',
                drawingId: 'drawing-1',
                timezone: 'UTC',
                idempotencyKey: 'idem-1'
            })).rejects.toBeInstanceOf(IdempotencyConflictError)
        }
    )
})
