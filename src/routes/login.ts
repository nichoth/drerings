import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button.js'
import { Input } from '../components/input.js'
import { type AppState } from '../state.js'
import './login.css'

export const LoginRoute:FunctionComponent<{
    state:AppState;
}> = function LoginRoute ({ state: _state }) {
    const handle = useSignal<string>('')

    const onSubmit = useCallback((ev:Event) => {
        ev.preventDefault()
        const value = handle.value.trim().replace(/^@/, '')
        if (!value) return
        const url = `/api/auth-login?handle=${encodeURIComponent(value)}`
        location.assign(url)
    }, [])

    return html`<div class="route login">
        <section>
            <h2>Sign in</h2>
            <p>Sign in with your Bluesky account.</p>
            <form onSubmit=${onSubmit}>
                <${Input}
                    label="Bluesky handle"
                    id="handle"
                    type="text"
                    required=${'true'}
                    value=${handle.value}
                    placeholder="alice.bsky.social"
                    onInput=${(ev:InputEvent) => {
                        const input = ev.currentTarget as HTMLInputElement
                        handle.value = input.value
                    }}
                />
                <${Button} type="submit">
                    Sign in with Bluesky
                <//>
            </form>
        </section>
    </div>`
}
