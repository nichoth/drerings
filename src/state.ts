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

export function State (): {
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
    currentUser:Signal<CurrentUser|null>;
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

function clearAuthState (state:AppState):void {
    state.auth.value = {
        registered: false,
        authenticated: false
    }
    state.currentUser.value = null
    state.profile.value = null
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
