import { html } from 'htm/preact'
import type { FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import { GiftStampsPanel } from '../components/gift-stamps.js'
import { StampLotsRefundPanel } from '../components/stamp-lots-refund.js'
import './settings.css'

export const SettingsRoute:FunctionComponent<{
    state:AppState;
}> = function ({ state }) {
    return html`<div class="route settings">
        <h2>Settings</h2>

        ${state.isAuthed.value ?
            html`<nav aria-label="Settings navigation" class="settings-nav">
                <a href="/settings/stamps">Stamps</a>
            </nav>
            <${GiftStampsPanel} state=${state} />
            <${StampLotsRefundPanel} state=${state} />` :
            html`<p>
                <a href="/login">Sign in</a> to manage your account.
            </p>`
        }
    </div>`
}
