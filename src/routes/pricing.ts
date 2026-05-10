import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const currentUser = state.currentUser.value
    const startCheckout = useCallback(async () => {
        await State.StartCheckout(state).catch(() => {})
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
            <p>
                Draw for free. Subscribe when you want to share them with the world.
                sharing.
            </p>
        </section>

        <section class="pricing-tiers" aria-label="Plans">
            <article class="pricing-tier">
                <h3>Free</h3>
                <p class="pricing-rate">$0/month</p>
                <ul>
                    <li>Draw in the browser.</li>
                    <li>Start over with every refresh.</li>
                    <li>No saved drawings or public posts.</li>
                </ul>
            </article>

            <article class="pricing-tier paid">
                <h3>Paid</h3>
                <p class="pricing-rate">$5/month</p>
                <ul>
                    <li>Save drawings to your account.</li>
                    <li>Reopen and edit saved drawings.</li>
                    <li>Publish drawings to stable public URLs.</li>
                </ul>
            </article>
        </section>

        <section
            class="pricing-checkout"
            aria-label="Checkout"
        >
            ${currentUser ? html`
                <p>
                    You are signed in as ${currentUser.email}.
                </p>
            ` : html`
                <p>
                    Please <a href="/login">sign in</a> before checkout.
                </p>
            `}

            <${Button}
                type="button"
                disabled=${!currentUser}
                isSpinning=${state.checkoutLoading}
                onClick=${currentUser ? startCheckout : undefined}
            >
                Subscribe - $5/month
            <//>

            ${state.checkoutError.value ?
                html`<p role="alert" class="pricing-error">
                    ${state.checkoutError.value}
                </p>` :
                null
            }
        </section>
    </div>`
}
