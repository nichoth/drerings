import { h, type FunctionComponent } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import {
    render,
    screen,
    within
} from '@testing-library/preact'
import { State, type AppState } from '../src/state'
import Router from '../src/routes/index'
import { HomeRoute } from '../src/routes/home'

vi.mock('@substrate-system/atrament', () => {
    return {
        MODE_DRAW: 'draw',
        MODE_ERASE: 'erase',
        default: class MockAtrament {
            color = '#000000'
            weight = 4
            mode = 'draw'
            smoothing = 0
            destroy = vi.fn()

            constructor (
                canvas?:HTMLCanvasElement,
                config:{ width?:number, height?:number } = {}
            ) {
                if (canvas?.tagName === 'CANVAS') {
                    if (config.width) canvas.width = config.width
                    if (config.height) canvas.height = config.height
                }
            }
        }
    }
})

vi.mock('@substrate-system/atrament/fill?worker', () => {
    return { default: {} }
})

describe('US-013 pricing page and paid CTAs', () => {
    it('routes /pricing to a pricing page with free and paid tiers', () => {
        const state = State()
        const Route = routeFor('/pricing', state)

        render(h(Route, { state }))

        expect(screen.getByRole('heading', { name: 'Pricing' })).toBeTruthy()
        expect(screen.getByRole('heading', {
            level: 3,
            name: 'Free'
        })).toBeTruthy()
        expect(screen.getByRole('heading', {
            level: 3,
            name: 'Paid'
        })).toBeTruthy()
        expect(screen.getAllByText(/\$5\/month/i).length).toBeGreaterThan(0)
        expect(screen.getByRole('button', {
            name: 'Subscribe - $5/month'
        })).toBeTruthy()
    })

    it(
        'lets visitors enter email and start checkout without signing in',
        () => {
            const state = State()
            const Route = routeFor('/pricing', state)

            render(h(Route, { state }))

            const checkout = screen.getByRole('region', { name: 'Checkout' })

            expect(within(checkout).queryByText(/sign in before checkout/i))
                .toBeNull()

            const emailInput = within(checkout)
                .getByLabelText(/email/i) as HTMLInputElement
            const subscribe = within(checkout).getByRole('button', {
                name: 'Subscribe - $5/month'
            }) as HTMLButtonElement

            expect(emailInput.type).toBe('email')
            expect(subscribe.disabled).toBe(false)
        }
    )

    it('links disabled drawing controls to pricing', () => {
        const state = State()

        render(h(HomeRoute, { state }))

        const tooltip = screen.getByRole('tooltip', {
            name: 'Paid drawing controls'
        })
        const pricing = within(tooltip).getByRole('link', {
            name: /pricing/i
        }) as HTMLAnchorElement

        expect(pricing.getAttribute('href')).toBe('/pricing')
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
