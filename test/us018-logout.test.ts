import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import { State } from '../src/state'

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-018 logout', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('clears the session cookie from the logout endpoint', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return {
                clearSessionCookie: () => [
                    'drerings_session=',
                    'Path=/',
                    'Max-Age=0'
                ].join('; '),
                readSessionUserFromCookie: () => null
            }
        })

        const { handler } = await import('../netlify/functions/auth/logout')
        const response = await callHandler(handler, logoutEvent('POST'))
        const body = JSON.parse(response.body || '{}')

        expect(response.statusCode).toBe(200)
        expect(response.headers?.['Set-Cookie'])
            .toContain('drerings_session=')
        expect(response.headers?.['Set-Cookie']).toContain('Max-Age=0')
        expect(body).toEqual({ ok: true })
    })

    it('rejects non-POST logout requests', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return {
                clearSessionCookie: () => 'drerings_session=;',
                readSessionUserFromCookie: () => null
            }
        })

        const { handler } = await import('../netlify/functions/auth/logout')
        const response = await callHandler(handler, logoutEvent('GET'))

        expect(response.statusCode).toBe(405)
    })

    it('posts logout, clears auth state, and redirects protected routes',
        async () => {
            const state = State()
            const pushState = vi.spyOn(history, 'pushState')
            const fetcher = vi.fn(async () => {
                return new Response(JSON.stringify({
                    logged_out: true
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            })

            vi.stubGlobal('fetch', fetcher)
            state._setRoute('/account')
            state.auth.value = {
                registered: true,
                authenticated: true
            }
            state.currentUser.value = {
                id: 'user-1',
                did: 'did:plc:test-1',
                handle: 'user.bsky.social'
            }
            state.account.value = {
                id: 'user-1',
                did: 'did:plc:test-1',
                handle: 'user.bsky.social',
                stamps_balance: 5
            }

            await State.Logout(state)

            expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', {
                method: 'POST'
            })
            expect(state.auth.value).toEqual({
                registered: false,
                authenticated: false
            })
            expect(state.currentUser.value).toBeNull()
            expect(state.account.value).toBeNull()
            expect(state.route.value).toBe('/login')
            expect(pushState).toHaveBeenCalledWith(null, '', '/login')
        })

    it('keeps the current public route after logout', async () => {
        const state = State()
        const pushState = vi.spyOn(history, 'pushState')
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                logged_out: true
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)
        state._setRoute('/')
        state.auth.value = {
            registered: true,
            authenticated: true
        }

        await State.Logout(state)

        expect(state.route.value).toBe('/')
        expect(pushState).not.toHaveBeenCalled()
    })
})

function logoutEvent (method:string):HandlerEvent {
    return {
        rawUrl: 'https://drerings.app/api/auth/logout',
        rawQuery: '',
        path: '/api/auth/logout',
        httpMethod: method,
        headers: {
            host: 'drerings.app'
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false
    }
}
