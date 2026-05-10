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

export function State (): {
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
    currentUser:Signal<CurrentUser|null>;
    currentDrawing:Signal<SavedDrawing|null>;
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
        currentDrawing: signal<SavedDrawing|null>(null),
        savedDrawings: signal<SavedDrawing[]>([]),
        savedDrawingsLoading: signal<boolean>(false),
        savedDrawingsError: signal<string|null>(null),
        profile: signal<UserState|null>(null),
        route: signal<string>(location.pathname),
        isAuthed: computed<boolean>(() => {
            return !!state.auth.value?.authenticated
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
    clearAuthState(state)
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

function clearAuthState (state:AppState):void {
    state.auth.value = {
        registered: false,
        authenticated: false
    }
    state.currentUser.value = null
    state.currentDrawing.value = null
    state.savedDrawings.value = []
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
