import { describe, expect, it, vi } from 'vitest'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

describe('US-005 passkey helpers', () => {
    const passkeysModule = '../netlify/lib/passkeys'

    it('signs challenge tokens and rejects tampering', async () => {
        vi.resetModules()
        vi.stubEnv('NODE_ENV', 'test')
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'))

        const {
            createPasskeyChallengeToken,
            verifyPasskeyChallengeToken
        } = await import(passkeysModule)

        const token = createPasskeyChallengeToken({
            challenge: 'challenge-1',
            origin: 'https://drerings.app',
            purpose: 'registration',
            userId: 'user-1'
        })

        expect(verifyPasskeyChallengeToken(
            token,
            'registration'
        )).toMatchObject({
            challenge: 'challenge-1',
            origin: 'https://drerings.app',
            purpose: 'registration',
            userId: 'user-1'
        })
        expect(verifyPasskeyChallengeToken(
            `${token.slice(0, -1)}x`,
            'registration'
        )).toBeNull()
        expect(verifyPasskeyChallengeToken(
            token,
            'authentication'
        )).toBeNull()

        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it('stores passkey public keys as base64url text', async () => {
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

        const { savePasskey } = await import(passkeysModule)

        await savePasskey({
            userId: 'user-1',
            credentialId: 'credential-1',
            publicKey: new Uint8Array([1, 2, 3, 4]),
            counter: 5
        })

        const call = query.mock.calls[0]!

        expect(call[0]).toContain('INSERT INTO passkeys')
        expect(call[1]).toEqual([
            'user-1',
            'credential-1',
            'AQIDBA',
            5
        ])
    })

    it('loads passkeys with public keys decoded for WebAuthn', async () => {
        vi.resetModules()

        const query = vi.fn<Query>(async () => {
            return {
                rows: [{
                    id: 'passkey-1',
                    user_id: 'user-1',
                    credential_id: 'credential-1',
                    public_key: 'AQIDBA',
                    counter: 5,
                    email: 'user@example.com',
                    subscription_status: 'free'
                }]
            }
        })

        vi.doMock('@netlify/database', () => {
            return {
                getDatabase: () => ({
                    pool: { query }
                })
            }
        })

        const { findPasskeyByCredentialId } = await import(passkeysModule)

        const passkey = await findPasskeyByCredentialId('credential-1')

        expect(passkey).toMatchObject({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-1',
            counter: 5,
            user: {
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'free'
            }
        })
        expect(Array.from(passkey!.publicKey)).toEqual([1, 2, 3, 4])
    })
})
