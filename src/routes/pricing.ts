import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { Input } from '../components/input'
import { State, type AppState } from '../state'
import { BuyPackModal } from '../components/buy-pack-modal'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const currentUser = state.currentUser.value
    const email = useSignal<string>(currentUser?.email || '')

    const startCheckout = useCallback(async (ev:Event) => {
        ev.preventDefault()
        await State.StartCheckout(state, email.value.trim()).catch(() => {})
    }, [state])

    const openBuyPacks = useCallback(() => {
        State.OpenBuyPackModal(state)
    }, [state])

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
            <p>
                Draw for free. Subscribe when you want to share your drawings
                with the world.
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
                    <li>Share your drawings via SMS, email, or Bluesky</li>
                </ul>
            </article>
        </section>

        <section class="stamp-pack-cta" aria-label="Stamps">
            <div>
                <h3>Stamps</h3>
                <p>
                    Buy prepaid stamps for sending postcards. One stamp sends
                    one postcard.
                </p>
            </div>

            <${Button} type="button" onClick=${openBuyPacks}>
                Buy stamps
            <//>
        </section>

        <section class="pricing-checkout" aria-label="Checkout">
            <form onSubmit=${startCheckout} class="pricing-checkout-form">
                <${Input}
                    label="Email"
                    name="email"
                    required=${true}
                    value=${email.value}
                    id="checkout-email"
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

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}
