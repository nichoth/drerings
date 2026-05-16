import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { Input } from '../components/input'
import { State, type AppState } from '../state'
import {
    formatPackPrice,
    formatPerStampPrice,
    STAMP_PACKS,
    type StampPackProductId
} from '../stamp-packs'
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

const BuyPackModal:FunctionComponent<{
    state:AppState;
    onClose:()=>void;
}> = function BuyPackModal ({ state, onClose }) {
    const buyPack = useCallback(async (productId:StampPackProductId) => {
        await State.StartStampCheckout(state, productId).catch(() => {})
    }, [state])

    return html`<div class="buy-pack-backdrop">
        <section
            class="buy-pack-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Buy stamps"
        >
            <header class="buy-pack-header">
                <h2>Buy stamps</h2>
                <${Button} type="button" onClick=${onClose}>
                    Close
                <//>
            </header>

            <div class="buy-pack-options" aria-label="Stamp packs">
                ${STAMP_PACKS.map((pack) => {
                    const productId = pack.productId as StampPackProductId
                    const isBuying =
                        state.stampCheckoutProductId.value === productId
                    const isRecommended = productId === 'stamps_bundle'

                    return html`<article
                        class=${[
                            'stamp-pack-option',
                            isRecommended ? 'recommended' : ''
                        ].filter(Boolean).join(' ')}
                        aria-label=${pack.name}
                    >
                        <div class="stamp-pack-topline">
                            <h3>${pack.name}</h3>
                            ${isRecommended ?
                                html`<span>Recommended</span>` :
                                null
                            }
                        </div>
                        <p class="stamp-pack-count">
                            ${pack.count} stamps
                        </p>
                        <p class="stamp-pack-price">
                            ${formatPackPrice(pack.priceCents)}
                        </p>
                        <p class="stamp-pack-unit">
                            ${formatPerStampPrice(pack)}
                        </p>
                        <${Button}
                            type="button"
                            disabled=${state.checkoutLoading.value}
                            isSpinning=${isBuying ?
                                state.checkoutLoading :
                                undefined
                            }
                            onClick=${() => buyPack(productId)}
                        >
                            Buy ${pack.name}
                        <//>
                    </article>`
                })}
            </div>

            ${state.checkoutError.value ?
                html`<p role="alert" class="pricing-error">
                    ${state.checkoutError.value}
                </p>` :
                null
            }
        </section>
    </div>`
}
