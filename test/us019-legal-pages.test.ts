import { h, type FunctionComponent } from 'preact'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import { readFileSync } from 'node:fs'
import { State, type AppState } from '../src/state'
import Router from '../src/routes/index'

describe('US-019 legal pages', () => {
    beforeEach(() => {
        document.title = ''
        document.head
            .querySelectorAll('meta[name="description"]')
            .forEach(meta => meta.remove())
    })

    it('routes /privacy to required data topics', async () => {
        const state = State()
        const Route = routeFor('/privacy', state)

        render(h(Route, { state }))

        expect(screen.getByRole('heading', {
            name: 'Privacy Policy'
        })).toBeTruthy()
        expect(screen.getByText(/email/i)).toBeTruthy()
        expect(screen.getAllByText(/drawings/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Autumn/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/payment metadata/i)).toBeTruthy()
        expect(screen.getByText(/retention/i)).toBeTruthy()
        expect(screen.getAllByText(/delete/i).length).toBeGreaterThan(0)
        expect(screen.getByRole('link', {
            name: 'support@drerings.app'
        })).toBeTruthy()

        await waitFor(() => {
            expect(document.title).toBe('Privacy Policy - Drerings')
        })
        expect(metaDescription()).toMatch(/privacy/i)
    })

    it('routes /terms to readable terms covering payment use', async () => {
        const state = State()
        const Route = routeFor('/terms', state)

        render(h(Route, { state }))

        expect(screen.getByRole('heading', {
            name: 'Terms of Service'
        })).toBeTruthy()
        expect(screen.getAllByText(/paid plan/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Autumn/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/drawings/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/delete your account/i)).toBeTruthy()
        expect(screen.getByRole('link', {
            name: 'support@drerings.app'
        })).toBeTruthy()

        await waitFor(() => {
            expect(document.title).toBe('Terms of Service - Drerings')
        })
        expect(metaDescription()).toMatch(/terms/i)
    })

    it('links to privacy and terms from the footer', () => {
        const source = readFileSync('src/index.ts', 'utf8')

        expect(source).toContain('href="/privacy"')
        expect(source).toContain('href="/terms"')
    })
})

function routeFor (
    path:string,
    state:AppState
):FunctionComponent<{ state:AppState }> {
    const router = Router(state)
    const match = router.match(path)
    const Route = match?.action?.(match, path)

    expect(Route).toBeTruthy()

    return Route as FunctionComponent<{ state:AppState }>
}

function metaDescription ():string {
    return document.querySelector('meta[name="description"]')
        ?.getAttribute('content') ?? ''
}
