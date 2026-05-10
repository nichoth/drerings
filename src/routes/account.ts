import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import './account.css'

export const AccountRoute:FunctionComponent<{
    state:AppState;
}> = function AccountRoute ({ state }) {
    const currentUser = state.currentUser.value
    const status = new URLSearchParams(location.search).get('status')

    return html`<div class="route account">
        <h2>Account</h2>

        <section aria-label="Subscription" class="account-subscription">
            ${status === 'ok' ?
                html`<p class="account-success">
                    Your subscription is being activated.
                </p>` :
                null
            }

            ${status === 'cancel' ?
                html`<p class="account-note">
                    Checkout was canceled. You can restart from pricing.
                </p>` :
                null
            }

            ${currentUser ?
                html`<p>
                    Signed in as ${currentUser.email}.
                </p>` :
                html`<p>
                    <a href="/login">Sign in</a> to manage your account.
                </p>`
            }
        </section>
    </div>`
}
