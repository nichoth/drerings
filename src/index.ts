import { html } from 'htm/preact'
import { type FunctionComponent, render } from 'preact'
import { useCallback, useMemo } from 'preact/hooks'
import { type Signal, useComputed, useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { State } from './state.js'
import { Button } from './components/button.js'
import Router, { routes } from './routes/index.js'
import { COPYRIGHT } from './constants.js'
import './style.css'

const state = State()
const router = Router(state)
const debug = Debug('drerings')

// set debug logging in local env
if (isDev()) {
    localStorage.setItem('DEBUG', 'drerings:*,drerings')
    // @ts-expect-error DEV env
    window.state = state
} else {
    localStorage.removeItem('DEBUG')
}

export const Drerings:FunctionComponent = function Drerings () {
    debug('rendering drerings...', state)

    const match = useMemo(() => {
        return router.match(state.route.value)
    }, [state.route.value])

    const logout = useCallback(() => {
        State.Logout(state)
    }, [])

    const isResolving = useSignal<boolean>(false)

    if (!match || !match.action) {
        return html`<div class="not-found">
            <h1>404</h1>
        </div>`
    }

    const isAuthed = useComputed<boolean>(() => {
        return !!state.auth.value?.authenticated
    })

    const ChildNode = match.action(match, state.route.value)

    return html`
    <header>
        <h1><a href="/">Drerings</a></h1>
        <${Nav} route=${state.route.value} isAuthed=${isAuthed} />

        <ul>
            ${state.authLoading.value ?
                html`
                    <li>
                        <${Button}
                            onClick=${() => {}}
                            disabled=${true}
                        >
                            Logout
                        <//>
                    </li>
                    <li>
                        <div class="avatar avatar-placeholder"></div>
                    </li>
                ` :
                isAuthed.value ?
                    html`
                        <li>
                            <${Button}
                                isSpinning=${isResolving}
                                onClick=${logout}
                            >
                                Logout
                            <//>
                        </li>
                        <li>
                            <div class="avatar">
                                <a href="/whoami">
                                    <img
                                        class="avatar"
                                        src="${state.profile.value?.avatar}"
                                    />
                                </a>
                            </div>
                        </li>
                    ` :
                    html`<li><a href="/login">Login</a></li>`
            }
        </ul>
    </header>

    <main>
        <${ChildNode} state=${state} />
    </main>
    <footer>
        <div>
            ${COPYRIGHT} 2026, <a href="https://bsky.app/profile/nichoth.com">
                @nichoth
            </a>
        </div>

        <iframe src="https://github.com/sponsors/nichoth/button" 
            title="Sponsor nichoth" 
            height="32" 
            width="114" 
            style="border: 0;">
        </iframe>
    </footer>
    `
}

render(html`<${Drerings} />`, document.getElementById('root')!)

function isDev ():boolean {
    return !!(import.meta.env.DEV || import.meta.env.MODE === 'staging')
}

function Nav ({
    route,
    isAuthed
}:{ route:string, isAuthed:Signal<boolean> }):ReturnType<typeof html> {
    return html`<nav aria-label="Main navigation">
        <ul>
            ${routes.map(r => {
                return html`<li class="nav${route === r.href ? ' active' : ''}">
                    <a href="${r.href}">${r.text}</a>
                </li>`
            }).concat(isAuthed.value ?
                [html`
                    <li><a href="/feed">Feed</a></li>
                    <li><a href="/whoami">Who Am I?</a></li>
                `] :
                []
            )}
        </ul>
    </nav>`

    // <li><a href="/contact">contact</a></li> -->
}

// <li><a href="/feed">Feed</a></li>
// <li><a href="/new">New Post</a></li>
// <li><a href="/whoami">Who Am I?</a></li>
