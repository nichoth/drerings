import { html } from 'htm/preact'
import { type FunctionComponent, render } from 'preact'
import { useCallback, useMemo } from 'preact/hooks'
import { useComputed, useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { State } from './state.js'
import { Button } from './components/button.js'
import { IconStamp } from './components/icon-stamp.js'
import Router, { routes } from './routes/index.js'
import { COPYRIGHT } from './constants.js'
import { ModalWindow } from '@substrate-system/dialog'
import { CharacterCounter } from '@substrate-system/character-counter'
import './style.css'

const state = State()
const router = Router(state)
const debug = Debug('drerings')

State.fetchAuthStatus(state).catch(err => {
    debug('auth status failed', err)
})

// set debug logging in local env
if (isDev()) {
    try { localStorage.setItem('DEBUG', 'drerings:*,drerings') } catch { /* */ }
    // @ts-expect-error DEV env
    window.state = state
} else {
    try { localStorage.removeItem('DEBUG') } catch { /* */ }
}

// one global FOUCE handler
(async () => {
    await Promise.race([
        // Load all custom elements
        Promise.allSettled([
            customElements.whenDefined(CharacterCounter.TAG),
            customElements.whenDefined(ModalWindow.TAG)
        ]),
        // Resolve after two seconds
        new Promise(resolve => setTimeout(resolve, 2000))
    ])

    // Remove the class, showing the page content
    document.body.classList.remove('reduce-fouce')
})()

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
        <${Nav}
            route=${state.route.value}
            isAuthed=${isAuthed.value}
            authLoading=${state.authLoading.value}
            stampsBalance=${state.currentUser.value?.stamps_balance}
        />

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
            ${COPYRIGHT} 2026, nichoth
        </div>

        <div>
            <a href="https://github.com/nichoth/drerings">
                See the source code
            </a>
        </div>

        <div>
            <a href="/privacy">Privacy</a>
            ${' '}
            <a href="/terms">Terms</a>
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

const root = document.getElementById('root')
if (root) render(html`<${Drerings} />`, root)

function isDev ():boolean {
    return !!(import.meta.env.DEV || import.meta.env.MODE === 'staging')
}

export function Nav (props:{
    route:string;
    isAuthed:boolean;
    authLoading:boolean;
    stampsBalance?:number;
}):ReturnType<typeof html> {
    const { route, isAuthed, authLoading, stampsBalance } = props
    const showBalance = isAuthed &&
        !authLoading &&
        typeof stampsBalance === 'number'

    return html`<nav aria-label="Main navigation">
        <ul>
            ${routes
                .filter(r =>
                    (r.href !== '/settings' && r.href !== '/account') ||
                    (!authLoading && isAuthed)
                )
                .map(r => {
                    const className = `nav${route === r.href ? ' active' : ''}`

                    return html`<li class=${className}>
                        <a href="${r.href}">${r.text}</a>
                    </li>`
                })}
            ${showBalance ?
                html`<li class="nav stamp-balance">
                    <a
                        class="stamp-balance-link"
                        href="/settings/stamps"
                    >
                        <${IconStamp} />
                        <span>${stampsBalanceLabel(stampsBalance)}</span>
                    </a>
                </li>` :
                null
            }
        </ul>
    </nav>`
}

function stampsBalanceLabel (balance:number):string {
    return `${balance} ${balance === 1 ? 'stamp' : 'stamps'}`
}
