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

export function State (): {
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    isAuthed:ReadonlySignal<boolean>;
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
    state.authLoading.value = false
    state.auth.value = {
        registered: false,
        authenticated: false
    }
    state.profile.value = null
    return state.auth.value
}

State.Logout = async function (state:AppState):Promise<void> {
    state.auth.value = {
        registered: false,
        authenticated: false
    }
    state.profile.value = null
}
