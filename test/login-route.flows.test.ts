import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { LoginRoute } from '../src/routes/login'
import { State } from '../src/state'

describe('login route', () => {
    it('renders a Bluesky handle form', () => {
        const state = State()

        render(h(LoginRoute, { state }))

        expect(screen.getByRole('heading', { name: 'Sign in' }))
            .toBeTruthy()
        expect(screen.getByLabelText(/bluesky handle/i))
            .toBeTruthy()
        expect(screen.getByRole('button', { name: /sign in with bluesky/i }))
            .toBeTruthy()
    })

    it('submitting the handle navigates to auth login endpoint', async () => {
        const user = userEvent.setup()
        const state = State()
        const assigned:string[] = []
        const mockAssign = vi.fn((url:string) => { assigned.push(url) })

        vi.stubGlobal('location', {
            ...window.location,
            assign: mockAssign
        })

        try {
            render(h(LoginRoute, { state }))

            await user.type(
                screen.getByLabelText(/bluesky handle/i),
                'alice.bsky.social'
            )
            await user.click(
                screen.getByRole('button', { name: /sign in with bluesky/i })
            )

            expect(assigned.length).toBe(1)
            expect(assigned[0]).toMatch(/^\/api\/auth\/login\?handle=/)
            expect(assigned[0]).toContain('alice.bsky.social')
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
