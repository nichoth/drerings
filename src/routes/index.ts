import Router from '@substrate-system/routes'
import { HomeRoute } from './home.js'
import { ContactRoute } from './contact.js'
import { ColophonRoute } from './colophon.js'

export default function _Router ():InstanceType<typeof Router> {
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

    return router
}

export const routes = [
    { href: '/', text: 'Home' },
    { href: '/colophon', text: 'About' }
]
