import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import './pricing.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const currentUser = state.currentUser.value
    const email = useSignal<string>(currentUser?.email || '')

    const startCheckout = useCallback(async (ev:Event) => {
        ev.preventDefault()
        const trimmed = email.value.trim()
        if (!EMAIL_RE.test(trimmed)) return
        await State.StartCheckout(state, trimmed).catch(() => {})
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
            <p>
                Draw for free. Subscribe when you want to share them with the
                world.
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
            <form onSubmit=${startCheckout} class="pricing-checkout-form">
                <label for="checkout-email">Email</label>
                <input
                    id="checkout-email"
                    name="email"
                    type="email"
                    autocomplete="email"
                    required
                    value=${email.value}
                    onInput=${(ev:InputEvent) => {
                        const input = ev.currentTarget as HTMLInputElement
                        email.value = input.value
                    }}
                />

                <${Button}
                    type="submit"
                    isSpinning=${state.checkoutLoading}
                >
                    Subscribe - $5/month
                <//>
            </form>

            ${state.checkoutError.value ?
                html`<p role="alert" class="pricing-error">
                    ${state.checkoutError.value}
                </p>` :
                null
            }
        </section>
    </div>`
}
