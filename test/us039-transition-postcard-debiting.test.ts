import {
    describe, expect, it, vi, beforeEach, afterEach
} from 'vitest'

type QueryRow = Record<string, unknown>
type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:QueryRow[] }>

describe('US-039 transition postcard to debiting', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.resetModules()
    })

    afterEach(() => {
        vi.resetModules()
    })

    it(
        'AC14.1: success — claim queued postcard returns {ok:true}',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('UPDATE postcards') &&
                    sql.includes('status = \'debiting\'')) {
                    return { rows: [{ status: 'debiting' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const {
                transitionPostcardToDebiting
            } = await import(
                '../netlify/lib/postcards.js'
            )

            const result = await transitionPostcardToDebiting('postcard-1')

            expect(result).toEqual({ ok: true })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE postcards'),
                ['postcard-1']
            )
        }
    )

    it(
        'AC14.2: failure — already debiting returns ' +
        '{ok:false, status:\'debiting\'}',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('UPDATE postcards') &&
                    sql.includes('status = \'debiting\'')) {
                    return { rows: [] }
                }
                if (sql.includes('SELECT status FROM postcards')) {
                    return { rows: [{ status: 'debiting' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const {
                transitionPostcardToDebiting
            } = await import(
                '../netlify/lib/postcards.js'
            )

            const result = await transitionPostcardToDebiting('postcard-1')

            expect(result).toEqual({ ok: false, status: 'debiting' })
        }
    )

    it(
        'AC14.3: failure — already sent returns ' +
        '{ok:false, status:\'sent\'}',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('UPDATE postcards') &&
                    sql.includes('status = \'debiting\'')) {
                    return { rows: [] }
                }
                if (sql.includes('SELECT status FROM postcards')) {
                    return { rows: [{ status: 'sent' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const {
                transitionPostcardToDebiting
            } = await import(
                '../netlify/lib/postcards.js'
            )

            const result = await transitionPostcardToDebiting('postcard-1')

            expect(result).toEqual({ ok: false, status: 'sent' })
        }
    )

    it(
        'AC14.4: failure — already failed returns ' +
        '{ok:false, status:\'failed_refunded\'}',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('UPDATE postcards') &&
                    sql.includes('status = \'debiting\'')) {
                    return { rows: [] }
                }
                if (sql.includes('SELECT status FROM postcards')) {
                    return { rows: [{ status: 'failed_refunded' }] }
                }
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const {
                transitionPostcardToDebiting
            } = await import(
                '../netlify/lib/postcards.js'
            )

            const result = await transitionPostcardToDebiting('postcard-1')

            expect(result).toEqual({
                ok: false,
                status: 'failed_refunded'
            })
        }
    )

    it(
        'AC14.5: failure — not found returns {ok:false, status:null}',
        async () => {
            const query = vi.fn<Query>(async () => {
                return { rows: [] }
            })

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: { query }
                })
            }))

            const {
                transitionPostcardToDebiting
            } = await import(
                '../netlify/lib/postcards.js'
            )

            const result = await transitionPostcardToDebiting('postcard-1')

            expect(result).toEqual({ ok: false, status: null })
        }
    )
})
