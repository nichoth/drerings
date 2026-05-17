import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import { type StampPackProductId } from './stamp-packs.js'

const debug = Debug('drerings:state')

export { RequestState, type RequestFor }

export interface AuthStatus {
    registered:boolean;
    authenticated:boolean;
}

export interface UserState {
    id:string;
    email:string;
}

export type SubscriptionStatus = 'free'|'active'|'canceled'|'past_due'

export interface CurrentUser extends UserState {
    subscription_status:SubscriptionStatus;
    stamps_balance?:number;
}

export interface AccountPasskey {
    id:string;
    created_at:string;
}

export interface AccountDetails extends CurrentUser {
    subscription_current_period_end:string|null;
    passkeys:AccountPasskey[];
}

export interface SavedDrawing {
    id:string;
    image:string;
    text:string;
    alt_text:string;
    updated_at:string;
}

export interface DrawingSaveInput {
    image:string;
    text:string;
    alt_text:string;
}

export interface PublishedPost {
    id:number;
}

export type PostcardSendResult =
    | { ok:true; id:string; balanceAfter:number }
    | {
        ok:false;
        reason:'insufficient_stamps'|'send_failed'|'other';
        message:string;
    }

export interface PublicPost extends PublishedPost {
    image:string;
    text:string;
    alt_text:string;
    published_at:string;
}

export type StampLotSource = 'purchase'|'grant'|'gift_received'

export interface StampLotSummary {
    id:string;
    source:StampLotSource;
    original_count:number;
    remaining_count:number;
    refund_cents:number;
    created_at:string;
}

export type PendingGiftStatus = 'pending'|'claimed'|'refunded'

export interface PendingGiftSummary {
    id:string;
    recipient_email:string;
    pack_id:StampPackProductId;
    count:number;
    price_cents:number;
    status:PendingGiftStatus;
    created_at:string;
}

export type SentGiftStatus = 'unused'|'in_use'|'expired'|'refunded'

export interface SentGiftSummary {
    id:string;
    recipient_email:string;
    original_count:number;
    remaining_count:number;
    refund_cents:number;
    refundable:boolean;
    refundable_until:string;
    status:SentGiftStatus;
    created_at:string;
}

export type StampTransactionReason =
    'purchase'|
    'grant'|
    'migration_grant'|
    'send'|
    'refund'|
    'gift_sent'|
    'gift_received'|
    'failed_send_refund'|
    'gift_reclaimed'

export interface StampTransactionSummary {
    id:string;
    delta:number;
    reason:StampTransactionReason;
    balance_after:number;
    created_at:string;
}

export interface StampTransactionPage {
    transactions:StampTransactionSummary[];
    next_before:string|null;
}

export interface StampRefundResult {
    refund_cents:number;
    stamps_balance:number;
}

export interface SentGiftRefundResult {
    refund_cents:number;
    recipient_stamps_balance?:number;
}

export interface GiftStampCheckoutInput {
    productId:StampPackProductId;
    recipient:string;
}

export function State (): {
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
    isPaid:ReadonlySignal<boolean>;
    canShare:ReadonlySignal<boolean>;
    currentUser:Signal<CurrentUser|null>;
    account:Signal<AccountDetails|null>;
    accountLoading:Signal<boolean>;
    accountError:Signal<string|null>;
    currentDrawing:Signal<SavedDrawing|null>;
    checkoutLoading:Signal<boolean>;
    checkoutError:Signal<string|null>;
    buyPackModalOpen:Signal<boolean>;
    stampCheckoutProductId:Signal<StampPackProductId|null>;
    savedDrawings:Signal<SavedDrawing[]>;
    savedDrawingsLoading:Signal<boolean>;
    savedDrawingsError:Signal<string|null>;
    stampLots:Signal<StampLotSummary[]>;
    pendingGifts:Signal<PendingGiftSummary[]>;
    sentGifts:Signal<SentGiftSummary[]>;
    stampTransactions:Signal<StampTransactionSummary[]>;
    stampTransactionsNextBefore:Signal<string|null>;
    stampTransactionsLoading:Signal<boolean>;
    stampTransactionsError:Signal<string|null>;
    stampLotsLoading:Signal<boolean>;
    stampLotsError:Signal<string|null>;
    profile:Signal<UserState|null>;
    _setRoute:(path:string)=>void;
} {  // eslint-disable-line indent
    const onRoute = Route()

    const state = {
        _setRoute: onRoute.setRoute.bind(onRoute),
        authLoading: signal<boolean>(false),
        auth: signal<AuthStatus>({
            registered: false,
            authenticated: false
        }),
        currentUser: signal<CurrentUser|null>(null),
        account: signal<AccountDetails|null>(null),
        accountLoading: signal<boolean>(false),
        accountError: signal<string|null>(null),
        currentDrawing: signal<SavedDrawing|null>(null),
        checkoutLoading: signal<boolean>(false),
        checkoutError: signal<string|null>(null),
        buyPackModalOpen: signal<boolean>(false),
        stampCheckoutProductId: signal<StampPackProductId|null>(null),
        savedDrawings: signal<SavedDrawing[]>([]),
        savedDrawingsLoading: signal<boolean>(false),
        savedDrawingsError: signal<string|null>(null),
        stampLots: signal<StampLotSummary[]>([]),
        pendingGifts: signal<PendingGiftSummary[]>([]),
        sentGifts: signal<SentGiftSummary[]>([]),
        stampTransactions: signal<StampTransactionSummary[]>([]),
        stampTransactionsNextBefore: signal<string|null>(null),
        stampTransactionsLoading: signal<boolean>(false),
        stampTransactionsError: signal<string|null>(null),
        stampLotsLoading: signal<boolean>(false),
        stampLotsError: signal<string|null>(null),
        profile: signal<UserState|null>(null),
        route: signal<string>(location.pathname),
        isAuthed: computed<boolean>(() => {
            return !!state.auth.value?.authenticated
        }),
        isPaid: computed<boolean>(() => {
            return state.currentUser.value?.subscription_status === 'active'
        }),
        canShare: computed<boolean>(() => {
            return state.currentUser.value?.subscription_status === 'active'
        })
    }

    onRoute((path:string, data) => {
        debug('path', path)
        if (path.includes('#')) {
            const pathParts = path.split('#')
            state.route.value = pathParts.shift()?.split('?').shift() || '/'
            return setTimeout(() => {
                document.getElementById(pathParts.pop()!)?.scrollIntoView()
            }, 1)
        }

        state.route.value = path.split('?').shift() || '/'
        if (data.popstate) {
            return window.scrollTo(data.scrollX, data.scrollY)
        }
        window.scrollTo(0, 0)
    })

    return state
}

export type AppState = ReturnType<typeof State>

export interface SavedDrawingResponse extends SavedDrawing {
    created_at?:string;
}

State.fetchAuthStatus = async function (state:AppState):Promise<AuthStatus> {
    state.authLoading.value = true

    try {
        const response = await fetch('/api/whoami')

        if (!response.ok) {
            clearAuthState(state)
            return state.auth.value
        }

        const user = await response.json() as CurrentUser

        if (!isCurrentUser(user)) {
            clearAuthState(state)
            return state.auth.value
        }

        state.currentUser.value = user
        state.profile.value = {
            id: user.id,
            email: user.email
        }
        state.auth.value = {
            registered: false,
            authenticated: true
        }

        return state.auth.value
    } catch {
        clearAuthState(state)
        return state.auth.value
    } finally {
        state.authLoading.value = false
    }
}

State.Logout = async function (state:AppState):Promise<void> {
    const shouldRedirect = isProtectedRoute(state.route.value)

    try {
        await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
        clearAuthState(state)
    }

    if (shouldRedirect) {
        state._setRoute('/login')
        history.pushState(null, '', '/login')
    }
}

State.SaveDrawing = async function (
    state:AppState,
    input:DrawingSaveInput
):Promise<SavedDrawingResponse> {
    const current = state.currentDrawing.value
    const url = current?.id ?
        `/api/drawings/${encodeURIComponent(current.id)}` :
        '/api/drawings'
    const method = current?.id ? 'PUT' : 'POST'
    const response = await fetch(url, {
        method,
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(input)
    })

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to save the drawing right now.'

        throw new Error(message)
    }

    const body = await response.json() as {
        id:string;
        created_at?:string;
        updated_at?:string;
    }
    const saved = {
        id: body.id,
        image: input.image,
        text: input.text,
        alt_text: input.alt_text,
        updated_at: body.updated_at || body.created_at || ''
    }

    state.currentDrawing.value = saved

    return {
        ...saved,
        created_at: body.created_at
    }
}

State.FetchSavedDrawings = async function (
    state:AppState
):Promise<SavedDrawing[]> {
    state.savedDrawingsLoading.value = true
    state.savedDrawingsError.value = null

    try {
        const response = await fetch('/api/drawings')

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to load drawings right now.'

            throw new Error(message)
        }

        const body = await response.json() as { drawings?:SavedDrawing[] }
        const drawings = Array.isArray(body.drawings) ? body.drawings : []

        state.savedDrawings.value = drawings

        return drawings
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to load drawings right now.'

        state.savedDrawingsError.value = message

        throw err
    } finally {
        state.savedDrawingsLoading.value = false
    }
}

State.FetchStampLots = async function (
    state:AppState
):Promise<StampLotSummary[]> {
    state.stampLotsLoading.value = true
    state.stampLotsError.value = null

    try {
        const response = await fetch('/api/stamps/lots')

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to load stamp lots right now.'

            throw new Error(message)
        }

        const body = await response.json() as {
            lots?:unknown;
            pending_gifts?:unknown;
            sent_gifts?:unknown;
        }
        const lots = Array.isArray(body.lots) ?
            body.lots.filter(isStampLotSummary) :
            []
        const pendingGifts = Array.isArray(body.pending_gifts) ?
            body.pending_gifts.filter(isPendingGiftSummary) :
            []
        const sentGifts = Array.isArray(body.sent_gifts) ?
            body.sent_gifts.filter(isSentGiftSummary) :
            []

        state.stampLots.value = lots
        state.pendingGifts.value = pendingGifts
        state.sentGifts.value = sentGifts

        return lots
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to load stamp lots right now.'

        state.stampLotsError.value = message

        throw err
    } finally {
        state.stampLotsLoading.value = false
    }
}

State.RefundStampLot = async function (
    state:AppState,
    lotId:string
):Promise<StampRefundResult> {
    const response = await fetch(
        `/api/stamps/refund/${encodeURIComponent(lotId)}`,
        { method: 'POST' }
    )

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to refund stamps right now.'

        throw new Error(message)
    }

    const result = await response.json() as Partial<StampRefundResult>

    if (
        typeof result.refund_cents !== 'number' ||
        typeof result.stamps_balance !== 'number'
    ) {
        throw new Error('Unable to refund stamps right now.')
    }

    if (state.currentUser.value) {
        state.currentUser.value = {
            ...state.currentUser.value,
            stamps_balance: result.stamps_balance
        }
    }

    state.stampLots.value = state.stampLots.value.map((lot) => {
        if (lot.id !== lotId) return lot

        return {
            ...lot,
            remaining_count: 0,
            refund_cents: 0
        }
    })

    return result as StampRefundResult
}

State.RefundSentGift = async function (
    state:AppState,
    lotId:string
):Promise<SentGiftRefundResult> {
    const response = await fetch(
        `/api/stamps/gifts/refund/${encodeURIComponent(lotId)}`,
        { method: 'POST' }
    )

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to refund gift right now.'

        throw new Error(message)
    }

    const result = await response.json() as Partial<SentGiftRefundResult>

    if (typeof result.refund_cents !== 'number') {
        throw new Error('Unable to refund gift right now.')
    }

    state.sentGifts.value = state.sentGifts.value.map((gift) => {
        if (gift.id !== lotId) return gift

        return {
            ...gift,
            remaining_count: 0,
            refund_cents: 0,
            refundable: false,
            status: 'refunded'
        }
    })

    return result as SentGiftRefundResult
}

State.FetchStampTransactions = async function (
    state:AppState,
    before?:string|null
):Promise<StampTransactionPage> {
    state.stampTransactionsLoading.value = true
    state.stampTransactionsError.value = null

    try {
        const url = before ?
            `/api/stamps/transactions?before=${encodeURIComponent(before)}` :
            '/api/stamps/transactions'
        const response = await fetch(url)

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to load stamp history right now.'

            throw new Error(message)
        }

        const body = await response.json() as Partial<StampTransactionPage>
        const transactions = Array.isArray(body.transactions) ?
            body.transactions.filter(isStampTransactionSummary) :
            []
        const page = {
            transactions,
            next_before: typeof body.next_before === 'string' ?
                body.next_before :
                null
        }

        state.stampTransactions.value = before ?
            state.stampTransactions.value.concat(page.transactions) :
            page.transactions
        state.stampTransactionsNextBefore.value = page.next_before

        return page
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to load stamp history right now.'

        state.stampTransactionsError.value = message

        throw err
    } finally {
        state.stampTransactionsLoading.value = false
    }
}

State.OpenSavedDrawing = async function (
    state:AppState,
    drawingId:string
):Promise<SavedDrawing> {
    const drawing = await State.FetchSavedDrawing(state, drawingId)

    state._setRoute('/')
    history.pushState(null, '', '/')

    return drawing
}

State.FetchSavedDrawing = async function (
    state:AppState,
    drawingId:string
):Promise<SavedDrawing> {
    const response = await fetch(
        `/api/drawings/${encodeURIComponent(drawingId)}`
    )

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to open the drawing right now.'

        throw new Error(message)
    }

    const drawing = await response.json() as SavedDrawing

    state.currentDrawing.value = drawing

    return drawing
}

State.DeleteSavedDrawing = async function (
    state:AppState,
    drawingId:string
):Promise<void> {
    const response = await fetch(
        `/api/drawings/${encodeURIComponent(drawingId)}`,
        { method: 'DELETE' }
    )

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to delete the drawing right now.'

        throw new Error(message)
    }

    state.savedDrawings.value = state.savedDrawings.value.filter((drawing) => {
        return drawing.id !== drawingId
    })

    if (state.currentDrawing.value?.id === drawingId) {
        state.currentDrawing.value = null
    }
}

State.GoToSendDrawing = function (
    state:AppState,
    drawingId:string
):void {
    if (state.currentUser.value?.stamps_balance === 0) {
        State.OpenBuyPackModal(state)
        return
    }

    const path = `/send/${encodeURIComponent(drawingId)}`

    state._setRoute(path)
    history.pushState(null, '', path)
}

State.PublishDrawing = async function (
    _state:AppState,
    drawingId:string
):Promise<PublishedPost> {
    const response = await fetch('/api/posts', {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({ drawing_id: drawingId })
    })

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to publish the drawing right now.'

        throw new Error(message)
    }

    const body = await response.json() as { id?:number|string }
    const id = Number(body.id)

    if (!Number.isFinite(id)) {
        throw new Error('Unable to publish the drawing right now.')
    }

    return { id }
}

State.SendPostcard = async function (
    _state:AppState,
    input:{
        drawingId:string;
        recipientEmail:string;
        idempotencyKey:string;
    }
):Promise<PostcardSendResult> {
    const response = await fetch('/api/postcards/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            drawing_id: input.drawingId,
            recipient_email: input.recipientEmail,
            idempotency_key: input.idempotencyKey
        })
    })

    const body = await maybeJson(response)

    if (response.status === 200) {
        return {
            ok: true,
            id: String(body?.id),
            balanceAfter: Number(body?.balance_after)
        }
    }

    if (response.status === 402) {
        return {
            ok: false,
            reason: 'insufficient_stamps',
            message: 'You need more stamps to send.'
        }
    }

    if (response.status === 502) {
        return {
            ok: false,
            reason: 'send_failed',
            message: typeof body?.error === 'string' ?
                'The postcard didn\'t go through — your stamp has been' +
                ' refunded.' :
                'Send failed; your stamp has been refunded.'
        }
    }

    return {
        ok: false,
        reason: 'other',
        message: typeof body?.error === 'string' ?
            body.error :
            'Unable to send the postcard right now.'
    }
}

State.StartCheckout = async function (
    state:AppState,
    email:string
):Promise<void> {
    state.checkoutLoading.value = true
    state.checkoutError.value = null

    try {
        const response = await fetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        })

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to start checkout right now.'

            throw new Error(message)
        }

        const body = await response.json() as { url?:unknown }

        if (typeof body.url !== 'string' || body.url.trim() === '') {
            throw new Error('Unable to start checkout right now.')
        }

        location.assign(body.url)
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to start checkout right now.'

        state.checkoutError.value = message

        throw err
    } finally {
        state.checkoutLoading.value = false
    }
}

State.OpenBuyPackModal = function (state:AppState):void {
    state.checkoutError.value = null
    state.buyPackModalOpen.value = true
}

State.CloseBuyPackModal = function (state:AppState):void {
    state.checkoutError.value = null
    state.stampCheckoutProductId.value = null
    state.buyPackModalOpen.value = false
}

State.StartStampCheckout = async function (
    state:AppState,
    productId:StampPackProductId
):Promise<void> {
    const email = state.currentUser.value?.email || state.profile.value?.email

    state.checkoutLoading.value = true
    state.checkoutError.value = null
    state.stampCheckoutProductId.value = productId

    try {
        if (!email) {
            throw new Error('Sign in before buying stamps.')
        }

        const response = await fetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                product_id: productId
            })
        })

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to start checkout right now.'

            throw new Error(message)
        }

        const body = await response.json() as { url?:unknown }

        if (typeof body.url !== 'string' || body.url.trim() === '') {
            throw new Error('Unable to start checkout right now.')
        }

        location.assign(body.url)
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to start checkout right now.'

        state.checkoutError.value = message

        throw err
    } finally {
        state.checkoutLoading.value = false
        state.stampCheckoutProductId.value = null
    }
}

State.StartGiftStampCheckout = async function (
    state:AppState,
    input:GiftStampCheckoutInput
):Promise<void> {
    state.checkoutLoading.value = true
    state.checkoutError.value = null
    state.stampCheckoutProductId.value = input.productId

    try {
        const response = await fetch('/api/stamps/gifts/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: input.productId,
                recipient: input.recipient
            })
        })

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to start gift checkout right now.'

            throw new Error(message)
        }

        const body = await response.json() as { url?:unknown }

        if (typeof body.url !== 'string' || body.url.trim() === '') {
            throw new Error('Unable to start gift checkout right now.')
        }

        location.assign(body.url)
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to start gift checkout right now.'

        state.checkoutError.value = message

        throw err
    } finally {
        state.checkoutLoading.value = false
        state.stampCheckoutProductId.value = null
    }
}

State.FetchAccount = async function (
    state:AppState
):Promise<AccountDetails> {
    state.accountLoading.value = true
    state.accountError.value = null

    try {
        const response = await fetch('/api/account')

        if (!response.ok) {
            const errorBody = await maybeJson(response)
            const message = typeof errorBody?.error === 'string' ?
                errorBody.error :
                'Unable to load account right now.'

            throw new Error(message)
        }

        const account = await response.json() as AccountDetails

        state.account.value = account
        state.currentUser.value = {
            id: account.id,
            email: account.email,
            subscription_status: account.subscription_status
        }

        return account
    } catch (err) {
        const message = err instanceof Error ?
            err.message :
            'Unable to load account right now.'

        state.accountError.value = message

        throw err
    } finally {
        state.accountLoading.value = false
    }
}

State.RequestEmailUpdate = async function (
    _state:AppState,
    email:string
):Promise<void> {
    const response = await fetch('/api/account/email', {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({ email })
    })

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to send the update link right now.'

        throw new Error(message)
    }
}

State.CancelSubscription = async function (
    state:AppState
):Promise<void> {
    const response = await fetch('/api/billing/cancel', { method: 'POST' })

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to cancel subscription right now.'

        throw new Error(message)
    }

    const body = await response.json() as Partial<AccountDetails>
    const account = state.account.value

    if (account) {
        state.account.value = {
            ...account,
            subscription_status: 'canceled',
            subscription_current_period_end:
                body.subscription_current_period_end || null
        }
    }

    if (state.currentUser.value) {
        state.currentUser.value = {
            ...state.currentUser.value,
            subscription_status: 'canceled'
        }
    }
}

State.RemovePasskey = async function (
    state:AppState,
    passkeyId:string
):Promise<void> {
    const response = await fetch(
        `/api/account/passkeys/${encodeURIComponent(passkeyId)}`,
        { method: 'DELETE' }
    )

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to remove passkey right now.'

        throw new Error(message)
    }

    if (state.account.value) {
        state.account.value = {
            ...state.account.value,
            passkeys: state.account.value.passkeys.filter((passkey) => {
                return passkey.id !== passkeyId
            })
        }
    }
}

State.DeleteAccount = async function (state:AppState):Promise<void> {
    const response = await fetch('/api/account', { method: 'DELETE' })

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Unable to delete account right now.'

        throw new Error(message)
    }

    clearAuthState(state)
    state._setRoute('/')
    history.pushState(null, '', '/')
}

State.FetchPublicPost = async function (
    _state:AppState,
    postId:string
):Promise<PublicPost> {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`)

    if (!response.ok) {
        const errorBody = await maybeJson(response)
        const message = typeof errorBody?.error === 'string' ?
            errorBody.error :
            'Post not found.'

        throw new Error(message)
    }

    const body = await response.json() as PublicPost
    const id = Number(body.id)

    if (
        !Number.isFinite(id) ||
        typeof body.image !== 'string' ||
        typeof body.text !== 'string' ||
        typeof body.alt_text !== 'string' ||
        typeof body.published_at !== 'string'
    ) {
        throw new Error('Unable to load the post right now.')
    }

    return {
        id,
        image: body.image,
        text: body.text,
        alt_text: body.alt_text,
        published_at: body.published_at
    }
}

function clearAuthState (state:AppState):void {
    state.auth.value = {
        registered: false,
        authenticated: false
    }
    state.currentUser.value = null
    state.currentDrawing.value = null
    state.checkoutError.value = null
    state.buyPackModalOpen.value = false
    state.stampCheckoutProductId.value = null
    state.savedDrawings.value = []
    state.stampLots.value = []
    state.pendingGifts.value = []
    state.sentGifts.value = []
    state.stampLotsError.value = null
    state.stampTransactions.value = []
    state.stampTransactionsNextBefore.value = null
    state.stampTransactionsError.value = null
    state.account.value = null
    state.accountError.value = null
    state.profile.value = null
}

async function maybeJson (
    response:Response
):Promise<Record<string, unknown>|null> {
    try {
        return await response.json() as Record<string, unknown>
    } catch {
        return null
    }
}

function isCurrentUser (value:unknown):value is CurrentUser {
    if (!value || typeof value !== 'object') return false

    const maybeUser = value as Partial<CurrentUser>
    const statuses:SubscriptionStatus[] = [
        'free',
        'active',
        'canceled',
        'past_due'
    ]

    return typeof maybeUser.id === 'string' &&
        typeof maybeUser.email === 'string' &&
        statuses.includes(
            maybeUser.subscription_status as SubscriptionStatus
        ) &&
        (
            maybeUser.stamps_balance === undefined ||
            typeof maybeUser.stamps_balance === 'number'
        )
}

function isStampLotSummary (value:unknown):value is StampLotSummary {
    if (!value || typeof value !== 'object') return false

    const maybeLot = value as Partial<StampLotSummary>
    const sources:StampLotSource[] = [
        'purchase',
        'grant',
        'gift_received'
    ]

    return typeof maybeLot.id === 'string' &&
        sources.includes(maybeLot.source as StampLotSource) &&
        typeof maybeLot.original_count === 'number' &&
        typeof maybeLot.remaining_count === 'number' &&
        typeof maybeLot.refund_cents === 'number' &&
        typeof maybeLot.created_at === 'string'
}

function isPendingGiftSummary (value:unknown):value is PendingGiftSummary {
    if (!value || typeof value !== 'object') return false

    const maybeGift = value as Partial<PendingGiftSummary>
    const statuses:PendingGiftStatus[] = [
        'pending',
        'claimed',
        'refunded'
    ]

    return typeof maybeGift.id === 'string' &&
        typeof maybeGift.recipient_email === 'string' &&
        isStampPackProductId(maybeGift.pack_id) &&
        typeof maybeGift.count === 'number' &&
        typeof maybeGift.price_cents === 'number' &&
        statuses.includes(maybeGift.status as PendingGiftStatus) &&
        typeof maybeGift.created_at === 'string'
}

function isSentGiftSummary (value:unknown):value is SentGiftSummary {
    if (!value || typeof value !== 'object') return false

    const maybeGift = value as Partial<SentGiftSummary>
    const statuses:SentGiftStatus[] = [
        'unused',
        'in_use',
        'expired',
        'refunded'
    ]

    return typeof maybeGift.id === 'string' &&
        typeof maybeGift.recipient_email === 'string' &&
        typeof maybeGift.original_count === 'number' &&
        typeof maybeGift.remaining_count === 'number' &&
        typeof maybeGift.refund_cents === 'number' &&
        typeof maybeGift.refundable === 'boolean' &&
        typeof maybeGift.refundable_until === 'string' &&
        statuses.includes(maybeGift.status as SentGiftStatus) &&
        typeof maybeGift.created_at === 'string'
}

function isStampTransactionSummary (
    value:unknown
):value is StampTransactionSummary {
    if (!value || typeof value !== 'object') return false

    const maybeTransaction = value as Partial<StampTransactionSummary>

    return typeof maybeTransaction.id === 'string' &&
        typeof maybeTransaction.delta === 'number' &&
        isStampTransactionReason(maybeTransaction.reason) &&
        typeof maybeTransaction.balance_after === 'number' &&
        typeof maybeTransaction.created_at === 'string'
}

function isStampTransactionReason (
    value:unknown
):value is StampTransactionReason {
    return value === 'purchase' ||
        value === 'grant' ||
        value === 'migration_grant' ||
        value === 'send' ||
        value === 'refund' ||
        value === 'gift_sent' ||
        value === 'gift_received' ||
        value === 'failed_send_refund' ||
        value === 'gift_reclaimed'
}

function isStampPackProductId (
    value:unknown
):value is StampPackProductId {
    return value === 'stamps_starter' ||
        value === 'stamps_bundle' ||
        value === 'stamps_big_bundle'
}

function isProtectedRoute (path:string):boolean {
    return path === '/account' ||
        path === '/drawings' ||
        path === '/settings' ||
        path === '/settings/stamps' ||
        path.startsWith('/send/')
}
