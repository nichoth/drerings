import Router from '@substrate-system/routes'
import { HomeRoute } from './home.js'
import { ContactRoute } from './contact.js'

export default function _Router ():InstanceType<typeof Router> {
    const router = new Router()

    router.addRoute('/', () => {
        return HomeRoute
    })

    router.addRoute('/contact', () => {
        return ContactRoute
    })

    return router
}

export const routes = [
    { href: '/', text: 'home' },
    { href: '/contact', text: 'contact' }
]
