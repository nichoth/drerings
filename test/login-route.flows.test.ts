import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { LoginRoute } from '../src/routes/login'
import { State } from '../src/state'

describe('login route', () => {
    it('renders a magic-link email form', () => {
        const state = State()

        render(h(LoginRoute, { state }))

        expect(screen.getByRole('heading', { name: 'Sign In' }))
            .toBeTruthy()
        expect(screen.getByLabelText(/email/i))
            .toBeTruthy()
        expect(screen.getByRole('button', { name: /send link/i }))
            .toBeTruthy()
    })

    it('shows a check-your-email state after requesting a link', async () => {
        const user = userEvent.setup()
        const state = State()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)

        render(h(LoginRoute, { state }))

        await user.type(
            screen.getByLabelText(/email/i),
            'user@example.com'
        )
        await user.click(screen.getByRole('button', { name: /send link/i }))

        await waitFor(() => {
            expect(screen.getByText(/check your email/i)).toBeTruthy()
        })
        expect(fetcher).toHaveBeenCalledWith('/api/auth/magic-link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: 'user@example.com' })
        })
    })
})
