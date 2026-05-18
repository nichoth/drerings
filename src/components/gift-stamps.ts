import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
    State,
    type AppState
} from '../state.js'
import {
    formatPackPrice,
    STAMP_PACKS,
    type StampPackProductId
} from '../stamp-packs.js'
import { Button } from './button.js'
import './gift-stamps.css'

export const GiftStampsPanel:FunctionComponent<{
    state:AppState;
}> = function GiftStampsPanel ({ state }) {
    const recipient = useSignal<string>('')
    const selectedPack = useSignal<StampPackProductId>('25_stamps')

    const startGiftCheckout = useCallback(async () => {
        await State.StartGiftStampCheckout(state, {
            productId: selectedPack.value,
            recipient: recipient.value.trim()
        }).catch(() => {})
    }, [state])

    return html`<section aria-label="Gift stamps" class="gift-stamps">
        <h3>Gift stamps</h3>

        <label class="gift-stamps-recipient" for="gift-recipient">
            Recipient email or username
            <input
                id="gift-recipient"
                name="recipient"
                value=${recipient.value}
                onInput=${(event:InputEvent) => {
                    const input = event.currentTarget as HTMLInputElement

                    recipient.value = input.value
                }}
            />
        </label>

        <fieldset>
            <legend>Stamp pack</legend>
            <div class="gift-stamps-packs">
                ${STAMP_PACKS.map((pack) => {
                    const productId = pack.productId as StampPackProductId

                    return html`<label class="gift-stamps-pack">
                        <input
                            type="radio"
                            name="gift-pack"
                            checked=${selectedPack.value === productId}
                            aria-label=${pack.name}
                            onChange=${() => {
                                selectedPack.value = productId
                            }}
                        />
                        <span>${pack.name}</span>
                        <span>${pack.count} stamps</span>
                        <span>${formatPackPrice(pack.priceCents)}</span>
                    </label>`
                })}
            </div>
        </fieldset>

        <${Button}
            type="button"
            disabled=${state.checkoutLoading.value}
            isSpinning=${state.checkoutLoading}
            onClick=${startGiftCheckout}
        >
            Continue to checkout
        <//>

        ${state.checkoutError.value ?
            html`<p role="alert" class="gift-stamps-error">
                ${state.checkoutError.value}
            </p>` :
            null
        }
    </section>`
}
