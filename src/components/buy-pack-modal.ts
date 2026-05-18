import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { State, type AppState } from '../state'
import {
    formatPackPrice,
    formatPerStampPrice,
    STAMP_PACKS,
    type StampPackProductId
} from '../stamp-packs'
import { Button } from './button'
import './buy-pack-modal.css'

export const BuyPackModal:FunctionComponent<{
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
                    const isRecommended = productId === '25_stamps'

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
