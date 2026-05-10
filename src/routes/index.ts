import Router from '@substrate-system/routes'
import { type AppState } from '../state.js'
import { HomeRoute } from './home.js'
import { ContactRoute } from './contact.js'
import { ColophonRoute } from './colophon.js'
import { LoginRoute } from './login.js'

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

    return router
}

export const routes = [
    { href: '/', text: 'Home' },
    { href: '/colophon', text: 'About' }
]
