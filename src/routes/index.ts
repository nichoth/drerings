import Router from '@substrate-system/routes'
import { State, type AppState } from '../state.js'
import { HomeRoute } from './home.js'
import { ContactRoute } from './contact.js'
import { ColophonRoute } from './colophon.js'
import { LoginRoute } from './login.js'
import { WhoamiRoute } from './whoami.js'
import { FeedRoute } from './feed.js'

export default function _Router (
    state:AppState
):InstanceType<typeof Router> {
    const router = new Router()

    router.addRoute('/', () => {
        return HomeRoute
    })

    router.addRoute('/feed', () => {
        State.fetchFeed(state)
        return FeedRoute
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

    router.addRoute('/whoami', () => {
        return WhoamiRoute
    })

    return router
}

export const routes = [
    { href: '/', text: 'Home' },
    { href: '/colophon', text: 'About' }
]
