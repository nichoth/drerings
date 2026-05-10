import Router from '@substrate-system/routes'
import { type AppState } from '../state.js'
import { HomeRoute } from './home.js'
import { ContactRoute } from './contact.js'
import { ColophonRoute } from './colophon.js'
import { LoginRoute } from './login.js'
import { SettingsRoute } from './settings.js'
import { DrawingsRoute } from './drawings.js'
import { SendRoute } from './send.js'
import { PostRoute } from './post.js'
import { PricingRoute } from './pricing.js'

export default function _Router (
    _state:AppState
):InstanceType<typeof Router> {
    const router = new Router()

    router.addRoute('/', () => {
        return HomeRoute
    })

    router.addRoute('/contact', () => {
        return ContactRoute
    })

    router.addRoute('/colophon', () => {
        return ColophonRoute
    })

    router.addRoute('/login', () => {
        return LoginRoute
    })

    router.addRoute('/settings', () => {
        return SettingsRoute
    })

    router.addRoute('/drawings', () => {
        return DrawingsRoute
    })

    router.addRoute('/send/:drawingId', () => {
        return SendRoute
    })

    router.addRoute('/post/:id', () => {
        return PostRoute
    })

    router.addRoute('/pricing', () => {
        return PricingRoute
    })

    return router
}

export const routes = [
    { href: '/', text: 'Home' },
    { href: '/drawings', text: 'Drawings' },
    { href: '/pricing', text: 'Pricing' },
    { href: '/colophon', text: 'About' },
    { href: '/settings', text: 'Settings' }
]
