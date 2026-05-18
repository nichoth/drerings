import { beforeEach, describe, expect, it, vi } from 'vitest'
import { State } from '../src/state'

describe('State.ShareDrawing', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('opens share sheet immediately on free precheck',
        async () => {
            const state = State()
            const fetchMock = vi.fn(async (url:string) => {
                if (url.endsWith('/api/shares/precheck')) {
                    return new Response(JSON.stringify({
                        type: 'free',
                        month_key: '2026-05'
                    }), { status: 200 })
                }
                if (url.endsWith('/api/shares/confirm')) {
                    return new Response(JSON.stringify({
                        type: 'recorded',
                        was_free: true,
                        stamps_balance: 0
                    }), { status: 200 })
                }
                return new Response('not found', { status: 404 })
            })
            // @ts-expect-error: assignment to global fetch mock in test
            globalThis.fetch = fetchMock

            let sheetOpened = false
            const result = await State.ShareDrawing(
                state,
                'drawing-1',
                async () => { sheetOpened = true }
            )

            expect(result.ok).toBe(true)
            expect(sheetOpened).toBe(true)
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/shares/precheck'),
                expect.objectContaining({ method: 'POST' })
            )
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/shares/confirm'),
                expect.objectContaining({ method: 'POST' })
            )
        })

    it('sets shareDialog to confirm on paid precheck', async () => {
        const state = State()
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                type: 'paid',
                stamps_balance: 3,
                month_key: '2026-05'
            }), { status: 200 })
        })
        // @ts-expect-error: assignment to global fetch mock in test
        globalThis.fetch = fetchMock

        const result = await State.ShareDrawing(
            state,
            'drawing-1',
            async () => {}
        )

        expect(result.ok).toBe(false)
        expect(state.shareDialog.value).toEqual(
            expect.objectContaining({ type: 'confirm' })
        )
        // Sanity: confirm was NOT called yet
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('sets shareDialog to blocked on blocked precheck', async () => {
        const state = State()
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                type: 'blocked',
                reason: 'no_free_no_stamps',
                stamps_balance: 0,
                month_key: '2026-05'
            }), { status: 200 })
        })
        // @ts-expect-error: assignment to global fetch mock in test
        globalThis.fetch = fetchMock

        const result = await State.ShareDrawing(
            state,
            'drawing-1',
            async () => {}
        )

        expect(result.ok).toBe(false)
        expect(state.shareDialog.value).toEqual(
            expect.objectContaining({ type: 'blocked' })
        )
    })
})

describe('State.ConfirmShare', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('reuses the supplied idempotencyKey on confirm', async () => {
        const state = State()
        const fetchMock = vi.fn(
            async (_url:string, init?:RequestInit) => {
                const body = JSON.parse(init?.body as string)
                return new Response(JSON.stringify({
                    type: 'recorded',
                    was_free: false,
                    stamps_balance: 4,
                    _echo: body
                }), { status: 200 })
            }
        )
        // @ts-expect-error: assignment to global fetch mock in test
        globalThis.fetch = fetchMock

        await State.ConfirmShare(
            state,
            'drawing-1',
            'idem-fixed',
            async () => {}
        )

        const callBody = JSON.parse(
            (fetchMock.mock.calls[0][1] as RequestInit).body as string
        )
        expect(callBody.idempotency_key).toBe('idem-fixed')
    })

    it('surfaces a network error with try again message',
        async () => {
            const state = State()
            const fetchMock = vi.fn(async () => {
                throw new Error('Network error')
            })
            // @ts-expect-error: assignment to global fetch mock in test
            globalThis.fetch = fetchMock

            // Pre-set the dialog as if precheck just set it
            state.shareDialog.value = {
                type: 'confirm',
                drawingId: 'drawing-1',
                idempotencyKey: 'idem-1',
                stampsBalance: 5
            }

            const result = await State.ConfirmShare(
                state,
                'drawing-1',
                'idem-1',
                async () => {}
            )

            expect(result.ok).toBe(false)
            if (!result.ok) {
                expect(result.reason).toBe('network')
            }
            expect(state.shareError.value).toBeTruthy()
            // The error message contains either the error or "Try again"
            // depending on the code path
            expect(state.shareError.value).toMatch(
                /Network error|try again|Try again/i
            )
        })
})
