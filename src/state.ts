import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'

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

export interface PublicPost extends PublishedPost {
    image:string;
    text:string;
    alt_text:string;
    published_at:string;
}

export function State (): {
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
    isPaid:ReadonlySignal<boolean>;
    currentUser:Signal<CurrentUser|null>;
    account:Signal<AccountDetails|null>;
    accountLoading:Signal<boolean>;
    accountError:Signal<string|null>;
    currentDrawing:Signal<SavedDrawing|null>;
    checkoutLoading:Signal<boolean>;
    checkoutError:Signal<string|null>;
    savedDrawings:Signal<SavedDrawing[]>;
    savedDrawingsLoading:Signal<boolean>;
    savedDrawingsError:Signal<string|null>;
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
        savedDrawings: signal<SavedDrawing[]>([]),
        savedDrawingsLoading: signal<boolean>(false),
        savedDrawingsError: signal<string|null>(null),
        profile: signal<UserState|null>(null),
        route: signal<string>(location.pathname),
        isAuthed: computed<boolean>(() => {
            return !!state.auth.value?.authenticated
        }),
        isPaid: computed<boolean>(() => {
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

State.StartCheckout = async function (
    state:AppState
):Promise<void> {
    state.checkoutLoading.value = true
    state.checkoutError.value = null

    try {
        const response = await fetch('/api/billing/checkout', {
            method: 'POST'
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
    state.savedDrawings.value = []
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
        statuses.includes(maybeUser.subscription_status as SubscriptionStatus)
}

function isProtectedRoute (path:string):boolean {
    return path === '/account' ||
        path === '/drawings' ||
        path === '/settings' ||
        path.startsWith('/send/')
}
