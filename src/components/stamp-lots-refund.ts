import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
    State,
    type AppState,
    type PendingGiftSummary,
    type SentGiftSummary,
    type StampLotSummary
} from '../state.js'
import { Button } from './button.js'
import './stamp-lots-refund.css'

export const StampLotsRefundPanel:FunctionComponent<{
    state:AppState;
}> = function StampLotsRefundPanel ({ state }) {
    const confirmLotId = useSignal<string>('')
    const confirmGiftId = useSignal<string>('')
    const message = useSignal<string>('')
    const error = useSignal<string>('')

    useEffect(() => {
        if (!state.isAuthed.value) return

        State.FetchStampLots(state).catch(() => {})
    }, [state, state.isAuthed.value])

    const requestRefund = useCallback((lot:StampLotSummary) => {
        confirmLotId.value = lot.id
        message.value = ''
        error.value = ''
    }, [])

    const cancelRefund = useCallback(() => {
        confirmLotId.value = ''
        confirmGiftId.value = ''
    }, [])

    const confirmRefund = useCallback(async (lot:StampLotSummary) => {
        message.value = ''
        error.value = ''

        try {
            const result = await State.RefundStampLot(state, lot.id)

            confirmLotId.value = ''
            message.value = [
                `Refunded ${formatMoney(result.refund_cents)}.`,
                `Your balance is ${result.stamps_balance} stamps.`
            ].join(' ')
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to refund stamps right now.'
        }
    }, [state])

    const requestGiftRefund = useCallback((gift:SentGiftSummary) => {
        confirmGiftId.value = gift.id
        confirmLotId.value = ''
        message.value = ''
        error.value = ''
    }, [])

    const confirmGiftRefund = useCallback(async (gift:SentGiftSummary) => {
        message.value = ''
        error.value = ''

        try {
            const result = await State.RefundSentGift(state, gift.id)

            confirmGiftId.value = ''
            message.value = `Gift refunded ${formatMoney(
                result.refund_cents
            )}.`
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to refund gift right now.'
        }
    }, [state])

    return html`<section
        id="stamps"
        aria-label="Stamp lots"
        class="stamp-lots"
    >
        <h3>Stamp lots</h3>
        <p class="stamp-lots-balance">
            ${state.currentUser.value?.stamps_balance ?? 0} stamps available
        </p>

        ${state.stampLotsLoading.value ?
            html`<p>Loading stamp lots...</p>` :
            stampLotsView()
        }

        ${pendingGiftsView()}

        ${sentGiftsView()}

        ${state.stampLotsError.value ?
            html`<p role="alert" class="stamp-lots-error">
                ${state.stampLotsError.value}
            </p>` :
            null
        }

        ${error.value ?
            html`<p role="alert" class="stamp-lots-error">
                ${error.value}
            </p>` :
            null
        }

        ${message.value ?
            html`<p role="status" class="stamp-lots-success">
                ${message.value}
            </p>` :
            null
        }
    </section>`

    function stampLotsView () {
        if (!state.stampLots.value.length) {
            return html`<p>No stamp lots yet.</p>`
        }

        return html`<ul class="stamp-lots-list">
            ${state.stampLots.value.map((lot) => {
                return html`<li
                    key=${lot.id}
                    class="stamp-lot"
                    aria-label=${formatDate(lot.created_at)}
                >
                    <div class="stamp-lot-heading">
                        <span class="stamp-lot-date">
                            ${formatDate(lot.created_at)}
                        </span>
                        <span class="stamp-lot-source">
                            ${sourceLabel(lot)}
                        </span>
                    </div>

                    <p class="stamp-lot-counts">
                        <span>${stampCountLabel(lot)}</span>
                        <span>${refundPreviewLabel(lot)}</span>
                    </p>

                    ${lotActions(lot)}
                </li>`
            })}
        </ul>`
    }

    function pendingGiftsView () {
        if (!state.pendingGifts.value.length) return null

        return html`<div class="pending-gifts">
            <h4>Pending gifts</h4>
            <ul class="pending-gifts-list">
                ${state.pendingGifts.value.map((gift) => {
                    return html`<li
                        key=${gift.id}
                        class="pending-gift"
                        aria-label=${pendingGiftLabel(gift)}
                    >
                        <span>${gift.recipient_email}</span>
                        <span>${gift.count} stamps</span>
                        <span>${formatMoney(gift.price_cents)}</span>
                        <span>${statusLabel(gift.status)}</span>
                    </li>`
                })}
            </ul>
        </div>`
    }

    function sentGiftsView () {
        if (!state.sentGifts.value.length) return null

        return html`<div class="sent-gifts">
            <h4>Sent gifts</h4>
            <ul class="sent-gifts-list">
                ${state.sentGifts.value.map((gift) => {
                    return html`<li
                        key=${gift.id}
                        class="sent-gift"
                        aria-label=${sentGiftLabel(gift)}
                    >
                        <span>${gift.recipient_email}</span>
                        <span>${gift.original_count} stamps</span>
                        <span>${sentGiftStatusLabel(gift)}</span>
                        ${sentGiftActions(gift)}
                    </li>`
                })}
            </ul>
        </div>`
    }

    function sentGiftActions (gift:SentGiftSummary) {
        if (!gift.refundable) return null

        if (confirmGiftId.value !== gift.id) {
            return html`<${Button}
                type="button"
                onClick=${() => requestGiftRefund(gift)}
            >
                Refund gift
            <//>`
        }

        return html`<div class="stamp-lot-actions">
            <p class="stamp-lot-confirm">
                ${sentGiftConfirmLabel(gift)}
            </p>
            <${Button}
                type="button"
                onClick=${() => confirmGiftRefund(gift)}
            >
                Confirm gift refund
            <//>
            <${Button} type="button" onClick=${cancelRefund}>Cancel<//>
        </div>`
    }

    function lotActions (lot:StampLotSummary) {
        if (!isRefundable(lot)) {
            return html`<span
                class="stamp-lot-note"
                title=${nonRefundableReason(lot)}
            >
                ${nonRefundableLabel(lot)}
            </span>`
        }

        if (confirmLotId.value !== lot.id) {
            return html`<${Button}
                type="button"
                onClick=${() => requestRefund(lot)}
            >
                Refund unused stamps
            <//>`
        }

        return html`<div class="stamp-lot-actions">
            <p class="stamp-lot-confirm">
                ${refundConfirmLabel(lot)}
            </p>
            <${Button} type="button" onClick=${() => confirmRefund(lot)}>
                Confirm refund
            <//>
            <${Button} type="button" onClick=${cancelRefund}>Cancel<//>
        </div>`
    }
}

function sentGiftLabel (gift:SentGiftSummary):string {
    return `${gift.recipient_email} ${gift.original_count} stamp gift`
}

function pendingGiftLabel (gift:PendingGiftSummary):string {
    return `${gift.recipient_email} ${gift.count} stamp gift`
}

function statusLabel (status:PendingGiftSummary['status']):string {
    return status.charAt(0).toUpperCase() + status.slice(1)
}

function sentGiftStatusLabel (gift:SentGiftSummary):string {
    if (gift.status === 'unused' && gift.refundable) {
        return `Unused (refundable until ${formatDate(
            gift.refundable_until
        )})`
    }

    if (gift.status === 'in_use') return 'In use (final)'
    if (gift.status === 'refunded') return 'Refunded'

    return 'Unused (final)'
}

function isRefundable (lot:StampLotSummary):boolean {
    return lot.source === 'purchase' &&
        lot.remaining_count > 0 &&
        lot.refund_cents > 0
}

function sourceLabel (lot:StampLotSummary):string {
    if (lot.source === 'purchase') return 'Purchased stamps'
    if (lot.source === 'gift_received') return 'Gift from another user'

    return 'Granted stamps'
}

function nonRefundableLabel (lot:StampLotSummary):string {
    if (lot.source === 'gift_received') return 'Gift from another user'
    if (lot.source === 'grant') return 'Granted stamps'

    return 'No refundable stamps left'
}

function nonRefundableReason (lot:StampLotSummary):string {
    if (lot.source === 'gift_received') {
        return 'Gifted stamps can only be managed by the sender.'
    }

    if (lot.source === 'grant') {
        return 'Granted stamps were free and cannot be refunded.'
    }

    return 'This purchased lot has no unused refundable stamps.'
}

function stampCountLabel (lot:StampLotSummary):string {
    return `${lot.remaining_count} of ${lot.original_count} stamps left`
}

function refundPreviewLabel (lot:StampLotSummary):string {
    return `${formatMoney(lot.refund_cents)} refund`
}

function refundConfirmLabel (lot:StampLotSummary):string {
    return `Refund ${formatMoney(lot.refund_cents)} to your card?`
}

function sentGiftConfirmLabel (gift:SentGiftSummary):string {
    return `Refund ${formatMoney(
        gift.refund_cents
    )} for ${gift.recipient_email}?`
}

function formatMoney (cents:number):string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(cents / 100)
}

function formatDate (value:string):string {
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) return value

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date)
}
