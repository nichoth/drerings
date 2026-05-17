import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    render,
    screen,
    within,
    fireEvent,
    waitFor
} from '@testing-library/preact'
import { State } from '../src/state'
import { SendRoute } from '../src/routes/send'

describe('US-031 postcard send route', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/send/drawing-1')
    })

    it(
        'AC5.1: renders recipient email input and Send postcard button',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(savedDrawing())
            }))

            render(h(SendRoute, { state }))

            expect(await screen.findByRole('img', {
                name: 'A hand drawn red circle'
            })).toBeTruthy()

            const emailInput = screen.getByLabelText('Recipient email')
            expect(emailInput).toBeTruthy()

            const sendButton = screen.getByRole('button', {
                name: 'Send postcard'
            })
            expect(sendButton).toBeTruthy()
        }
    )

    it(
        'AC5.2: opens buy modal when API returns 402 insufficient_stamps',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async (url) => {
                if (typeof url === 'string' &&
                    url.includes('/api/drawings')) {
                    return jsonResponse(savedDrawing())
                }
                if (typeof url === 'string' &&
                    url.includes('/api/postcards/send')) {
                    return jsonResponse(
                        { error: 'insufficient_stamps' },
                        false,
                        402
                    )
                }
                return jsonResponse({})
            }))

            render(h(SendRoute, { state }))

            const emailInput = await screen.findByLabelText(
                'Recipient email'
            )
            fireEvent.change(emailInput, {
                target: { value: 'recipient@example.com' }
            })

            const sendButton = screen.getByRole('button', {
                name: 'Send postcard'
            })
            fireEvent.click(sendButton)

            await waitFor(() => {
                expect(state.buyPackModalOpen.value).toBe(true)
            })
        }
    )

    it(
        'AC5.3: shows refund message when API returns 502 send_failed',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async (url) => {
                if (typeof url === 'string' &&
                    url.includes('/api/drawings')) {
                    return jsonResponse(savedDrawing())
                }
                if (typeof url === 'string' &&
                    url.includes('/api/postcards/send')) {
                    return jsonResponse(
                        { error: 'send_failed' },
                        false,
                        502
                    )
                }
                return jsonResponse({})
            }))

            render(h(SendRoute, { state }))

            const emailInput = await screen.findByLabelText(
                'Recipient email'
            )
            fireEvent.change(emailInput, {
                target: { value: 'recipient@example.com' }
            })

            const sendButton = screen.getByRole('button', {
                name: 'Send postcard'
            })
            fireEvent.click(sendButton)

            // Wait for the error message to appear
            const alert = await screen.findByRole('alert')
            expect(alert.textContent).toContain('stamp has been refunded')
        }
    )

    it(
        'AC5.4 (negative): Publish button does NOT show stamp cost',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(savedDrawing())
            }))

            render(h(SendRoute, { state }))

            await screen.findByRole('img', {
                name: 'A hand drawn red circle'
            })

            const publishButton = screen.getByRole('button', {
                name: 'Publish'
            })

            // Find the closest parent group
            const publishGroup = publishButton.closest(
                '[role="group"]'
            ) as HTMLElement|null
            expect(publishGroup).toBeTruthy()

            // The publish group should NOT contain "1 stamp"
            const stampIndicator = within(publishGroup!
            ).queryByText('1 stamp')
            expect(stampIndicator).toBeNull()
        }
    )
})

function paidState ():ReturnType<typeof State> {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active',
        stamps_balance: 3
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
}

function savedDrawing () {
    return {
        id: 'drawing-1',
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        updated_at: '2026-05-10T12:10:00.000Z'
    }
}

function jsonResponse (
    body:unknown,
    ok = true,
    status = 200
):Response {
    return {
        ok,
        status,
        json: async () => body
    } as Response
}
