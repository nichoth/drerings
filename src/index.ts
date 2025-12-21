import { html } from 'htm/preact'
import { type FunctionComponent, render } from 'preact'
import Debug from '@substrate-system/debug'
import { State } from './state.js'
import Router, { routes } from './routes/index.js'
import { COPYRIGHT } from './constants.js'
import './style.css'

const router = Router()
const state = State()
const debug = Debug('example')

// set debug logging in local env
if (isDev()) {
    localStorage.setItem('DEBUG', 'drerings:*,drerings')
    // @ts-expect-error DEV env
    window.state = state
} else {
    localStorage.removeItem('DEBUG')
    localStorage.removeItem('debug')
}

export const Example:FunctionComponent = function Example () {
    debug('rendering example...', state)
    const match = router.match(state.route.value)

    if (!match || !match.action) {
        return html`<div class="not-found">
            <h1>404</h1>
        </div>`
    }

    const ChildNode = match.action(match, state.route.value)

    return html`
    <header>
        <h1><a href="/">Drerings</a></h1>

        <${Nav} route=${state.route.value} />

        <div><a href="/login">Login</a></div>
    </header>
    <main>
        <${ChildNode} state=${state} />
    </main>
    <footer>
        ${COPYRIGHT} 2025, <a href="https://bsky.app/profile/nichoth.com">
            @nichoth
        </a>
    </footer>
    `
}

render(html`<${Example} />`, document.getElementById('root')!)

function isDev ():boolean {
    return !!(import.meta.env.DEV || import.meta.env.MODE === 'staging')
}

function Nav ({ route }:{ route:string }):ReturnType<typeof html> {
    return html`<nav aria-label="Main navigation">
        <ul>
            ${routes.map(r => {
                return html`<li class="nav${route === r.href ? ' active' : ''}">
                    <a href="${r.href}">${r.text}</a>
                </li>`
            })}
        </ul>
    </nav>`

    // <li><a href="/contact">contact</a></li> -->
}
