import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{
    rowCount?:number;
    rows:Array<Record<string, unknown>>;
}>

describe('US-017 account store', () => {
    it('loads account details with subscription and passkeys', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('FROM users')) {
                return {
                    rows: [{
                        id: 'user-1',
                        email: 'paid@example.com',
                        subscription_status: 'active',
                        subscription_current_period_end: '2026-06-01'
                    }]
                }
            }

            return {
                rows: [{
                    id: 'passkey-1',
                    created_at: '2026-05-01T00:00:00.000Z'
                }]
            }
        })

        mockDatabase(query)

        const { getAccountDetails } = await import('../netlify/lib/account')
        const account = await getAccountDetails('user-1')

        expect(account).toEqual({
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active',
            subscription_current_period_end: '2026-06-01',
            passkeys: [{
                id: 'passkey-1',
                created_at: '2026-05-01T00:00:00.000Z'
            }]
        })
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM users'),
            ['user-1']
        )
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM passkeys'),
            ['user-1']
        )
    })

    it('confirms an email update from a single-use token', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'user-1',
                    email: 'new@example.com',
                    subscription_status: 'free'
                }]
            }
        })

        mockDatabase(query)

        const { confirmEmailUpdate } = await import('../netlify/lib/account')
        const user = await confirmEmailUpdate('token-1')

        expect(user?.email).toBe('new@example.com')
        expect(query.mock.calls[0]![0]).toContain('UPDATE magic_link_tokens')
        expect(query.mock.calls[0]![0]).toContain('pending_email')
        expect(query.mock.calls[0]![0]).toContain('UPDATE users')
    })

    it('deletes account data and drawing blobs', async () => {
        vi.resetModules()

        const deleteDrawingImage = vi.fn(async () => {})
        const query = vi.fn<Query>(async (sql) => {
            if (sql.includes('SELECT blob_key')) {
                return {
                    rows: [{
                        id: 'drawing-1',
                        blob_key: 'users/user-1/drawings/drawing-1.png'
                    }]
                }
            }

            return { rowCount: 1, rows: [] }
        })

        mockDatabase(query)
        vi.doMock('../netlify/lib/drawing-images', () => {
            return { deleteDrawingImage }
        })

        const { deleteAccountData } = await import('../netlify/lib/account')
        await deleteAccountData('user-1')

        expect(query.mock.calls.map(call => call[0]).join('\n'))
            .toContain('DELETE FROM public_posts')
        expect(query.mock.calls.map(call => call[0]).join('\n'))
            .toContain('DELETE FROM users')
        expect(deleteDrawingImage).toHaveBeenCalledWith(
            'users/user-1/drawings/drawing-1.png'
        )
    })
})

function mockDatabase (query:ReturnType<typeof vi.fn<Query>>):void {
    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { query }
            })
        }
    })
}
