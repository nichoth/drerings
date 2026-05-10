import { h } from 'preact'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { LoginRoute } from '../src/routes/login'
import { State } from '../src/state'

describe('login route', () => {
    it('renders the backend rebuild placeholder', () => {
        const state = State()

        render(h(LoginRoute, { state }))

        expect(screen.getByRole('heading', { name: 'Sign In' }))
            .toBeTruthy()
        expect(screen.getByText(/sign-in is being rebuilt/i))
            .toBeTruthy()
    })
})
