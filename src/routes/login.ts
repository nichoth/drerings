import { html } from 'htm/preact'
import type { FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import './login.css'

export const LoginRoute:FunctionComponent<{ state:AppState }> = function () {
    return html`<div class="route login">
        <h2>Sign In</h2>
        <p>
            Account sign-in is being rebuilt for the new backend.
        </p>
    </div>`
}
