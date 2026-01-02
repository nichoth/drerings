import { type Signal, signal } from '@preact/signals'
import { type Agent } from '@atproto/api'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import ky from 'ky'
const debug = Debug('drerings:state')

export interface AuthStatus {
    registered:boolean;
    authenticated:boolean;
}

export const AUTH_ROUTES:string[] = ([
    '/repos',
    import.meta.env.VITE_ALLOW_ANON_READS ? null : ['/', '/lookup']
]).filter(Boolean).flat()

export type RequestFor<T, E=Error> = {
    pending:boolean;
    data:null|T;
    error:null|E
}

/**
 * Create initial request state.
 * @returns {RequestFor<T, E>}
 */
export function RequestState<T = any, E=Error> ():RequestFor<T, E> {
    return { pending: false, data: null, error: null }
}

export interface UserState {
    did:string;
    handle:string;
    avatar:string;
}

/**
 * Setup any state
 *   - routes
 */
export function State ():{
    route:Signal<string>;
    auth:Signal<AuthStatus>;
    authLoading:Signal<boolean>;
    agent:Signal<Agent|null>;
    profile:Signal<UserState|null>;
    _setRoute:(path:string)=>void;
} {  // eslint-disable-line indent
    const onRoute = Route()

    const state = {
        _setRoute: onRoute.setRoute.bind(onRoute),
        authLoading: signal<boolean>(false),
        auth: signal({
            registered: false,
            authenticated: false
        }),
        agent: signal(null),
        profile: signal(null),
        route: signal<string>(location.pathname + location.search)
    }

    /**
     * set the app state to match the browser URL
     */
    onRoute((path:string, data) => {
        state.route.value = path
        // handle scroll state like a web browser
        // (restore scroll position on back/forward)
        if (data.popstate) {
            return window.scrollTo(data.scrollX, data.scrollY)
        }
        // if this was a link click (not back button), then scroll to top
        window.scrollTo(0, 0)
    })

    return state
}

export type AppState = ReturnType<typeof State>

/**
 * Logout
 */
State.Logout = async function (state:AppState):Promise<void> {
    try {
        await ky.post('/api/auth/logout')
        state.auth.value = { registered: true, authenticated: false }
    } catch (err) {
        debug('logout error', err)
    }
}

