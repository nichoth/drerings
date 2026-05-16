import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import {
    State,
    type AppState,
    type StampTransactionReason,
    type StampTransactionSummary
} from '../state.js'
import { Button } from '../components/button.js'
import { BuyPackModal } from '../components/buy-pack-modal.js'
import { GiftStampsPanel } from '../components/gift-stamps.js'
import { StampLotsRefundPanel } from '../components/stamp-lots-refund.js'
import './stamps.css'

export const StampsRoute:FunctionComponent<{
    state:AppState;
}> = function StampsRoute ({ state }) {
    const openBuyPacks = useCallback(() => {
        State.OpenBuyPackModal(state)
    }, [state])

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    useEffect(() => {
        if (!state.isAuthed.value) return

        State.FetchStampTransactions(state).catch(() => {})
    }, [state, state.isAuthed.value])

    if (!state.isAuthed.value) {
        return html`<div class="route stamps-page">
            <h2>Stamps</h2>
            <p>
                <a href="/login">Sign in</a> to manage your stamps.
            </p>
        </div>`
    }

    return html`<div class="route stamps-page">
        <header class="stamps-page-header">
            <div>
                <h2>Stamps</h2>
                <p class="stamps-page-balance">
                    ${state.currentUser.value?.stamps_balance ?? 0}
                    stamps available
                </p>
            </div>
            <${Button} type="button" onClick=${openBuyPacks}>
                Buy more stamps
            <//>
        </header>

        <${StampTransactionHistory} state=${state} />
        <${GiftStampsPanel} state=${state} />
        <${StampLotsRefundPanel} state=${state} />

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}

const StampTransactionHistory:FunctionComponent<{
    state:AppState;
}> = function StampTransactionHistory ({ state }) {
    const loadMore = useCallback(() => {
        State.FetchStampTransactions(
            state,
            state.stampTransactionsNextBefore.value
        ).catch(() => {})
    }, [state])

    return html`<section
        aria-label="Transaction history"
        class="stamp-history"
    >
        <h3>Transaction history</h3>

        ${state.stampTransactionsLoading.value &&
            !state.stampTransactions.value.length ?
                html`<p>Loading stamp history...</p>` :
                transactionsView()
        }

        ${state.stampTransactionsError.value ?
            html`<p role="alert" class="stamp-history-error">
                ${state.stampTransactionsError.value}
            </p>` :
            null
        }

        ${state.stampTransactionsNextBefore.value ?
            html`<${Button}
                type="button"
                disabled=${state.stampTransactionsLoading.value}
                isSpinning=${state.stampTransactionsLoading}
                onClick=${loadMore}
            >
                Load more transactions
            <//>` :
            null
        }
    </section>`

    function transactionsView () {
        if (!state.stampTransactions.value.length) {
            return html`<p>No stamp transactions yet.</p>`
        }

        return html`<ul class="stamp-history-list">
            ${state.stampTransactions.value.map((transaction) => {
                return html`<li
                    key=${transaction.id}
                    class="stamp-history-item"
                    aria-label=${transactionLabel(transaction)}
                >
                    <span>${formatDate(transaction.created_at)}</span>
                    <span>${reasonLabel(transaction.reason)}</span>
                    <span>${formatDelta(transaction.delta)}</span>
                    <span>Balance ${transaction.balance_after}</span>
                </li>`
            })}
        </ul>`
    }
}

function transactionLabel (transaction:StampTransactionSummary):string {
    return [
        reasonLabel(transaction.reason),
        formatDelta(transaction.delta),
        `balance ${transaction.balance_after}`
    ].join(' ')
}

function formatDelta (delta:number):string {
    if (delta > 0) return `+${delta}`

    return String(delta)
}

function reasonLabel (reason:StampTransactionReason):string {
    const labels:Record<StampTransactionReason, string> = {
        purchase: 'Purchase',
        grant: 'Signup grant',
        migration_grant: 'Rollout grant',
        send: 'Postcard sent',
        refund: 'Refund',
        gift_sent: 'Gift sent',
        gift_received: 'Gift received',
        failed_send_refund: 'Failed-send refund',
        gift_reclaimed: 'Gift reclaimed'
    }

    return labels[reason]
}

function formatDate (value:string):string {
    const date = new Date(value)

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    }).format(date)
}
