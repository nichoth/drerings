import { describe, expect, it, vi } from 'vitest'

describe('GET /api/auth/callback', () => {
    it('returns 400 when state is missing from query', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn()
        const callbackSpy = vi.fn()

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({
                callback: callbackSpy
            })
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: { code: 'authcode-1' },
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(400)
        expect(upsertSpy).not.toHaveBeenCalled()
        expect(callbackSpy).not.toHaveBeenCalled()
    })

    it('returns 400 when code is missing from query', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn()
        const callbackSpy = vi.fn()

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({
                callback: callbackSpy
            })
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: { state: 'state-1' },
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(400)
        expect(upsertSpy).not.toHaveBeenCalled()
    })

    it('returns 400 when client.callback rejects (mismatched state)',
        async () => {
            vi.resetModules()

            const upsertSpy = vi.fn()
            const callbackSpy = vi.fn(async () => {
                throw new Error('invalid_state')
            })

            vi.doMock('../netlify/lib/auth-store.js', () => ({
                upsertOAuthUser: upsertSpy
            }))
            vi.doMock('../netlify/lib/auth/atproto.js', () => ({
                getOAuthClient: () => ({
                    callback: callbackSpy
                })
            }))

            const { handler } = await import(
                '../netlify/functions/auth/callback'
            )
            const response = await handler({
                httpMethod: 'GET',
                queryStringParameters: {
                    state: 'wrong-state',
                    code: 'authcode-1'
                },
                headers: {}
            } as never, {} as never)

            expect(response.statusCode).toBe(400)
            expect(upsertSpy).not.toHaveBeenCalled()
        })

    it('refreshes handle on re-login for existing DID (AC1.2)',
        async () => {
            vi.resetModules()

            const upsertSpy = vi.fn(async (
                did:string,
                handle:string
            ) => ({
                user: { id: 'user-1', did, handle, stamps_balance: 0 },
                wasInserted: false
            }))

            const callbackSpy = vi.fn(async () => ({
                session: {
                    sub: 'did:plc:alice',
                    agent: {
                        com: { atproto: { server: {
                            getSession: async () => ({
                                data: { handle: 'alice-new.bsky.social' }
                            })
                        } } }
                    }
                }
            }))

            vi.doMock('../netlify/lib/auth-store.js', () => ({
                upsertOAuthUser: upsertSpy
            }))
            vi.doMock('../netlify/lib/auth/atproto.js', () => ({
                getOAuthClient: () => ({ callback: callbackSpy })
            }))
            vi.doMock('../netlify/lib/session.js', () => ({
                createSessionCookie: (user:never) => 'session-cookie'
            }))

            const { handler } = await import(
                '../netlify/functions/auth/callback'
            )
            const response = await handler({
                httpMethod: 'GET',
                queryStringParameters: {
                    state: 'state-1',
                    code: 'authcode-1'
                },
                headers: {}
            } as never, {} as never)

            expect(response.statusCode).toBe(302)
            expect(upsertSpy).toHaveBeenCalledWith(
                'did:plc:alice',
                'alice-new.bsky.social'
            )
        })

    it('upserts the user with did/handle on success', async () => {
        vi.resetModules()

        const upsertSpy = vi.fn(async () => ({
            user: {
                id: 'user-1',
                did: 'did:plc:test',
                handle: 'alice.bsky.social',
                stamps_balance: 5
            },
            wasInserted: true
        }))

        const callbackSpy = vi.fn(async () => ({
            session: {
                sub: 'did:plc:test',
                agent: {
                    com: {
                        atproto: {
                            server: {
                                getSession: async () => ({
                                    data: { handle: 'alice.bsky.social' }
                                })
                            }
                        }
                    }
                }
            }
        }))

        vi.doMock('../netlify/lib/auth-store.js', () => ({
            upsertOAuthUser: upsertSpy
        }))
        vi.doMock('../netlify/lib/auth/atproto.js', () => ({
            getOAuthClient: () => ({ callback: callbackSpy })
        }))
        vi.doMock('../netlify/lib/session.js', () => ({
            createSessionCookie: (user:never) => 'session-cookie'
        }))

        const { handler } = await import(
            '../netlify/functions/auth/callback'
        )
        const response = await handler({
            httpMethod: 'GET',
            queryStringParameters: {
                state: 'state-1',
                code: 'authcode-1'
            },
            headers: {}
        } as never, {} as never)

        expect(response.statusCode).toBe(302)
        expect(upsertSpy).toHaveBeenCalledWith(
            'did:plc:test',
            'alice.bsky.social'
        )
    })
})
