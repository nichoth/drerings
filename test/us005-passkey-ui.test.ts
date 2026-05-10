import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { LoginRoute } from '../src/routes/login'
import { State } from '../src/state'

const webAuthn = vi.hoisted(() => {
    return {
        browserSupportsWebAuthn: vi.fn(() => true),
        startAuthentication: vi.fn(async () => {
            return { id: 'credential-1' }
        }),
        startRegistration: vi.fn(async () => {
            return { id: 'credential-1' }
        })
    }
})

vi.mock('@simplewebauthn/browser', () => {
    return webAuthn
})

describe('US-005 passkey UI', () => {
    const settingsModule = '../src/routes/settings'

    beforeEach(() => {
        webAuthn.browserSupportsWebAuthn.mockReturnValue(true)
        webAuthn.startAuthentication.mockClear()
        webAuthn.startRegistration.mockClear()
        vi.unstubAllGlobals()
    })

    it('adds passkey sign-in to the login page when supported', async () => {
        const user = userEvent.setup()
        const state = State()
        const fetcher = vi.fn(async (url:string, init?:RequestInit) => {
            if (url === '/api/auth/passkey/login/options') {
                return new Response(JSON.stringify({
                    options: { challenge: 'login-challenge' },
                    challenge_token: 'login-token'
                }))
            }

            if (url === '/api/auth/passkey/login/verify') {
                expect(init?.method).toBe('POST')
                expect(JSON.parse(String(init?.body))).toEqual({
                    challenge_token: 'login-token',
                    response: { id: 'credential-1' }
                })

                return new Response(JSON.stringify({ verified: true }))
            }

            throw new Error(`Unexpected fetch ${url}`)
        })

        vi.stubGlobal('fetch', fetcher)

        render(h(LoginRoute, { state }))

        await user.click(screen.getByRole('button', {
            name: /sign in with passkey/i
        }))

        await waitFor(() => {
            expect(webAuthn.startAuthentication).toHaveBeenCalledWith({
                optionsJSON: { challenge: 'login-challenge' }
            })
        })
        expect(state.auth.value.authenticated).toBe(true)
    })

    it('falls back to magic-link only when passkeys are unsupported', () => {
        webAuthn.browserSupportsWebAuthn.mockReturnValue(false)

        render(h(LoginRoute, { state: State() }))

        expect(screen.queryByRole('button', {
            name: /sign in with passkey/i
        })).toBeNull()
        expect(screen.getByRole('button', { name: /send link/i }))
            .toBeTruthy()
    })

    it('shows passkey registration only for signed-in users', async () => {
        const user = userEvent.setup()
        const state = State()
        const { SettingsRoute } = await import(settingsModule)
        const fetcher = vi.fn(async (url:string, init?:RequestInit) => {
            if (url === '/api/auth/passkey/register/options') {
                return new Response(JSON.stringify({
                    options: { challenge: 'registration-challenge' },
                    challenge_token: 'registration-token'
                }))
            }

            if (url === '/api/auth/passkey/register/verify') {
                expect(init?.method).toBe('POST')
                expect(JSON.parse(String(init?.body))).toEqual({
                    challenge_token: 'registration-token',
                    response: { id: 'credential-1' }
                })

                return new Response(JSON.stringify({ verified: true }))
            }

            throw new Error(`Unexpected fetch ${url}`)
        })

        vi.stubGlobal('fetch', fetcher)

        render(h(SettingsRoute, { state }))

        expect(screen.queryByRole('button', {
            name: /register a passkey/i
        })).toBeNull()

        state.auth.value = {
            registered: false,
            authenticated: true
        }
        state.profile.value = {
            id: 'user-1',
            email: 'user@example.com'
        }

        await waitFor(() => {
            expect(screen.getByRole('button', {
                name: /register a passkey/i
            })).toBeTruthy()
        })
        await user.click(screen.getByRole('button', {
            name: /register a passkey/i
        }))

        await waitFor(() => {
            expect(webAuthn.startRegistration).toHaveBeenCalledWith({
                optionsJSON: { challenge: 'registration-challenge' }
            })
        })
        expect(screen.getByText(/passkey registered/i)).toBeTruthy()
    })
})
