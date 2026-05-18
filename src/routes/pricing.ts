import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import { BuyPackModal } from '../components/buy-pack-modal'
import {
    STAMP_PACKS,
    formatPackPrice,
    type StampPackProductId
} from '../stamp-packs'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
    const openBuyPacks = useCallback(
        (productId?:StampPackProductId) => {
            State.OpenBuyPackModal(state, productId)
        },
        [state]
    )

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    return html`<div class="route pricing">
        <section class="pricing-intro">
            <h2>Pricing</h2>
        </section>

        <section class="pricing-tier-card" aria-label="Free tier">
            <h3>Sign in (free)</h3>
            <ul>
                <li>Draw in your browser.</li>
                <li>Save drawings to your account.</li>
                <li>Reopen and edit saved drawings.</li>
                <li>Publish drawings to stable public URLs.</li>
                <li>
                    One free share per calendar month.
                    Additional shares use 1 stamp each.
                </li>
            </ul>
        </section>

        <section class="pricing-stamp-packs" aria-label="Stamp packs">
            <h3>Stamps</h3>
            <p>
                Buy prepaid stamps to send postcards and to make
                additional shares after your monthly free share.
            </p>

            <ul class="pack-list">
                ${STAMP_PACKS.map(pack => html`<li
                    class="pack-row"
                    key=${pack.productId}
                >
                    <div class="pack-info">
                        <span class="pack-name">${pack.name}</span>
                        <span class="pack-count">
                            ${pack.count} stamps
                        </span>
                        <span class="pack-price">
                            ${formatPackPrice(pack.priceCents)}
                        </span>
                    </div>
                    <${Button}
                        type="button"
                        aria-label=${'Buy ' + pack.count + '-stamp pack'}
                        onClick=${() => openBuyPacks(
                            pack.productId as StampPackProductId
                        )}
                    >
                        Buy
                    <//>
                </li>`)}
            </ul>
        </section>

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}
