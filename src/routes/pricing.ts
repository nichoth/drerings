import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { Button } from '../components/button'
import { State, type AppState } from '../state'
import { BuyPackModal } from '../components/buy-pack-modal'
import './pricing.css'

export const PricingRoute:FunctionComponent<{
    state:AppState;
}> = function PricingRoute ({ state }) {
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
                Draw for free. Buy stamps to send postcards.
            </p>
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

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}
