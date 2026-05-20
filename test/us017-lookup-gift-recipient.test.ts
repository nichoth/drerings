import { describe, expect, it, vi } from 'vitest'

describe('lookupGiftRecipient', () => {
    it('AC1.1: Success - handle lookup', async () => {
        vi.resetModules()

        const query = vi.fn(async (_sql:string, _params?:unknown[]) => {
            if (_sql.includes('WHERE lower(handle) = $1')) {
                return {
                    rows: [{
                        id: 'user-alice',
                        handle: 'alice.bsky.social',
                        did: 'did:plc:abc123'
                    }]
                }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { lookupGiftRecipient } = await import('../netlify/lib/billing.js')
        const result = await lookupGiftRecipient('alice.bsky.social')

        expect(result).toEqual({
            id: 'user-alice',
            handle: 'alice.bsky.social',
            did: 'did:plc:abc123'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE lower(handle) = $1'),
            ['alice.bsky.social']
        )
    })

    it('AC1.2: Success - DID lookup', async () => {
        vi.resetModules()

        const query = vi.fn(async (_sql:string, _params?:unknown[]) => {
            if (_sql.includes('WHERE did = $1')) {
                return {
                    rows: [{
                        id: 'user-alice',
                        handle: 'alice.bsky.social',
                        did: 'did:plc:abc123'
                    }]
                }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { lookupGiftRecipient } = await import('../netlify/lib/billing.js')
        const result = await lookupGiftRecipient('did:plc:abc123')

        expect(result).toEqual({
            id: 'user-alice',
            handle: 'alice.bsky.social',
            did: 'did:plc:abc123'
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE did = $1'),
            ['did:plc:abc123']
        )
    })

    it('AC1.3: Success - case-insensitive handle', async () => {
        vi.resetModules()

        const query = vi.fn(async (_sql:string, _params?:unknown[]) => {
            if (_sql.includes('WHERE lower(handle) = $1')) {
                return {
                    rows: [{
                        id: 'user-alice',
                        handle: 'alice.bsky.social',
                        did: 'did:plc:abc123'
                    }]
                }
            }
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { lookupGiftRecipient } = await import('../netlify/lib/billing.js')
        const result = await lookupGiftRecipient('Alice.BSKY.Social')

        expect(result).toEqual({
            id: 'user-alice',
            handle: 'alice.bsky.social',
            did: 'did:plc:abc123'
        })
        // Verify the parameter is lowercased
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE lower(handle) = $1'),
            ['alice.bsky.social']
        )
    })

    it('AC1.4: Failure - not found', async () => {
        vi.resetModules()

        const query = vi.fn(async (_sql:string, _params?:unknown[]) => {
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { lookupGiftRecipient } = await import('../netlify/lib/billing.js')
        const result = await lookupGiftRecipient('unknown.bsky.social')

        expect(result).toBeNull()
        expect(query).toHaveBeenCalled()
    })

    it('AC1.5: Failure - empty input', async () => {
        vi.resetModules()

        const query = vi.fn(async (_sql:string, _params?:unknown[]) => {
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => ({
            getDatabase: () => ({
                pool: { query }
            })
        }))

        const { lookupGiftRecipient } = await import('../netlify/lib/billing.js')

        const result1 = await lookupGiftRecipient('')
        expect(result1).toBeNull()

        const result2 = await lookupGiftRecipient('   ')
        expect(result2).toBeNull()

        // Verify query was not called for empty/whitespace input
        expect(query).not.toHaveBeenCalled()
    })
})
