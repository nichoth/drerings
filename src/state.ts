import {
    computed,
    type ReadonlySignal,
    type Signal,
    signal
} from '@preact/signals'
import { type Agent } from '@atproto/api'
import Route from 'route-event'
import Debug from '@substrate-system/debug'
import {
    startAuthentication,
    startRegistration,
} from '@simplewebauthn/browser'
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { RequestState, type RequestFor } from '@substrate-system/state'
import ky from 'ky'
const debug = Debug('drerings:state')

export { RequestState, type RequestFor }
export interface AuthStatus {
    registered:boolean;
    authenticated:boolean;
}

export const AUTH_ROUTES:string[] = ([
    '/repos',
    import.meta.env.VITE_ALLOW_ANON_READS ? null : ['/', '/lookup']
]).filter(Boolean).flat()

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
    isAuthed:ReadonlySignal<boolean>;
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
        route: signal<string>(location.pathname + location.search),
        isAuthed: computed<boolean>(() => {
            return !!state.auth.value?.authenticated
        })
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

type RegisterOptionsResponse = {
    options:PublicKeyCredentialCreationOptionsJSON;
    challengeKey:string;
}

type LoginOptionsResponse = {
    options:PublicKeyCredentialRequestOptionsJSON;
    challengeKey:string;
}

type AuthStatusResponse = Partial<AuthStatus> & {
    profile?:UserState|null;
}

State.fetchAuthStatus = async function (state:AppState):Promise<AuthStatus> {
    state.authLoading.value = true
    try {
        const authStatus = await ky.get('/api/auth/status')
            .json<AuthStatusResponse>()

        state.auth.value = {
            registered: !!authStatus?.registered,
            authenticated: !!authStatus?.authenticated
        }
        state.profile.value = authStatus?.profile || null
        return state.auth.value
    } catch (err) {
        debug('fetch auth status error', err)
        throw err
    } finally {
        state.authLoading.value = false
    }
}

/**
 * Authenticate with a passkey.
 */
State.login = async function (state:AppState):Promise<void> {
    const optionsRes = await ky.post('/api/auth/authenticate/options')
        .json<LoginOptionsResponse>()

    const credential = await startAuthentication({
        optionsJSON: optionsRes.options,
    })

    await ky.post('/api/auth/authenticate/verify', {
        json: {
            challengeKey: optionsRes.challengeKey,
            response: credential,
        }
    })

    await State.fetchAuthStatus(state)
}

/**
 * Register a passkey.
 */
State.register = async function (state:AppState, secret:string):Promise<void> {
    const normalizedSecret = secret.trim()
    if (!normalizedSecret) {
        throw new Error('Registration secret is required')
    }

    const optionsRes = await ky.post('/api/auth/register/options', {
        json: { secret: normalizedSecret }
    }).json<RegisterOptionsResponse>()

    const credential = await startRegistration({
        optionsJSON: optionsRes.options,
    })

    await ky.post('/api/auth/register/verify', {
        json: {
            secret: normalizedSecret,
            challengeKey: optionsRes.challengeKey,
            response: credential,
        }
    })

    await State.fetchAuthStatus(state)
}

/**
 * Logout
 */
State.Logout = async function (state:AppState):Promise<void> {
    try {
        await ky.post('/api/auth/logout')
        state.auth.value = { registered: true, authenticated: false }
        state.profile.value = null
        state.agent.value = null
    } catch (err) {
        debug('logout error', err)
    }
}
