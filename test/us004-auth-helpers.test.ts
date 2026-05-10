import { afterEach, describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-004 auth helpers', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('creates a magic-link token with a 15-minute expiry', async () => {
        vi.resetModules()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'))

        const query = vi.fn<Query>(async () => {
            return { rows: [{ user_id: 'user-1' }] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { createMagicLinkLogin } = await import(
            '../netlify/lib/auth-store'
        )
        const login = await createMagicLinkLogin('user@example.com')

        expect(login.userId).toBe('user-1')
        expect(login.token.length).toBeGreaterThan(20)
        expect(login.expiresAt.toISOString())
            .toBe('2026-05-10T12:15:00.000Z')
        const call = query.mock.calls[0]!
        expect(call[1][0]).toBe('user@example.com')
        expect(call[1][1]).toBe(login.token)
        expect(call[1][2]).toEqual(login.expiresAt)

        vi.useRealTimers()
    })

    it('returns null when a magic-link token cannot be consumed', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return { rows: [] }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { consumeMagicLinkToken } = await import(
            '../netlify/lib/auth-store'
        )

        expect(await consumeMagicLinkToken('spent-token')).toBeNull()
        const call = query.mock.calls[0]!
        expect(call[1]).toEqual(['spent-token'])
        expect(call[0]).toContain('used_at IS NULL')
        expect(call[0]).toContain('expires_at > now()')
    })

    it('sends magic-link email through Resend env configuration', async () => {
        vi.resetModules()
        vi.stubEnv('RESEND_API_KEY', 'resend-key')
        vi.stubEnv('RESEND_FROM_EMAIL', 'Login <login@example.com>')

        const fetcher = vi.fn(async (
            _url:string,
            _init:RequestInit
        ) => {
            return new Response('{}', { status: 200 })
        })

        vi.stubGlobal('fetch', fetcher)

        const { sendMagicLinkEmail } = await import('../netlify/lib/resend')

        await sendMagicLinkEmail({
            email: 'user@example.com',
            loginUrl: 'https://drerings.app/login?token=token-1'
        })

        const call = fetcher.mock.calls[0]!
        const init = call[1]
        const headers = init.headers as Record<string, string>
        const request = JSON.parse(init.body as string)

        expect(call[0]).toBe('https://api.resend.com/emails')
        expect(headers.Authorization)
            .toBe('Bearer resend-key')
        expect(request.from).toBe('Login <login@example.com>')
        expect(request.to).toBe('user@example.com')
        expect(request.text).toContain('token=token-1')
    })
})
