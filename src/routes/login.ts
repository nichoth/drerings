import { html } from 'htm/preact'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { FunctionComponent } from 'preact'
import { useComputed, useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import { Button } from '../components/button.js'
import { State } from '../state.js'
import type { AppState } from '../state.js'
import './login.css'

const debug = Debug('drerings:login')

function queryFromRoute (route:string):URLSearchParams {
    const queryIndex = route.indexOf('?')
    if (queryIndex === -1) return new URLSearchParams()
    return new URLSearchParams(route.slice(queryIndex + 1))
}

async function getErrorMessage (err:unknown, fallback:string):Promise<string> {
    if (!(err instanceof Error)) {
        return fallback
    }

    try {
        const body = await (err as { response?:Response })
            .response?.json() as { error?:string }
        return body?.error || err.message || fallback
    } catch {
        return err.message || fallback
    }
}

export const LoginRoute:FunctionComponent<{ state:AppState }> = function ({
    state
}) {
    const handle = useSignal('')
    const submitting = useSignal<RequestFor<null, Error>>(RequestState(null))
    const error = useSignal<string|null>(null)
    const success = useSignal<string|null>(null)
    const isSubmitting = useComputed<boolean>(() => submitting.value.pending)
    const callbackHandled = useRef(false)

    useEffect(() => {
        const query = queryFromRoute(state.route.value)
        if (!State.hasOAuthCallback(query) || callbackHandled.current) return

        callbackHandled.current = true

        const oauthError = State.readOAuthError(query)
        if (oauthError) {
            error.value = oauthError
            State.clearOAuthQuery()
            return
        }

        RequestState.start(submitting)
        error.value = null
        success.value = null

        const finishOAuth = async ():Promise<void> => {
            try {
                await State.finishOAuth(state, query)
                RequestState.set(submitting, null)
                success.value = 'Signed in with Bluesky.'
                State.clearOAuthQuery()

                setTimeout(() => {
                    state._setRoute('/')
                }, 350)
            } catch (err) {
                debug('oauth callback error', err)
                RequestState.error(submitting, err as Error)
                error.value = await getErrorMessage(err, 'OAuth login failed')
            }
        }

        finishOAuth()
    }, [state.route.value])

    const startOAuth = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (submitting.value.pending) return

        const normalizedHandle = handle.value.trim()
        if (!normalizedHandle) {
            error.value = 'Enter your Bluesky handle'
            return
        }

        RequestState.start(submitting)
        error.value = null
        success.value = null

        try {
            await State.login(state, normalizedHandle)
            RequestState.set(submitting, null)
        } catch (err) {
            debug('oauth start error', err)
            RequestState.error(submitting, err as Error)
            error.value = await getErrorMessage(err, 'Unable to start OAuth login')
        }
    }, [])

    const auth = state.auth.value
    const callbackQuery = queryFromRoute(state.route.value)
    const isOAuthCallback = State.hasOAuthCallback(callbackQuery)

    if (auth?.authenticated) {
        return html`<div class="route login">
            <h2>Sign In</h2>
            <p class="already-authenticated">
                You are already logged in. <a href="/">Go to Dashboard</a>
            </p>
        </div>`
    }

    return html`<div class="route login">
        <h2>Sign In</h2>
        <p class="login-intro">
            Sign in with your Bluesky account using OAuth.
        </p>

        ${error.value && html`<p class="error-banner">${error.value}</p>`}
        ${success.value && html`<p class="success-message">${success.value}</p>`}

        ${isOAuthCallback && isSubmitting.value ? html`
            <p class="login-status">Completing Bluesky login...</p>
        ` : html`
            <form class="login-form" onSubmit=${startOAuth}>
                <div class="input">
                    <label for="bsky-handle">Bluesky Handle</label>
                    <input
                        id="bsky-handle"
                        name="bsky-handle"
                        type="text"
                        placeholder="alice.bsky.social"
                        value=${handle.value}
                        onInput=${(e:Event) => {
                            handle.value = (e.target as HTMLInputElement).value
                        }}
                        disabled=${isSubmitting.value}
                        autocomplete="username"
                    />
                </div>
                <div class="controls">
                    <${Button}
                        type="submit"
                        isSpinning=${isSubmitting}
                        disabled=${!handle.value.trim()}
                    >
                        Continue with Bluesky
                    <//>
                </div>
            </form>
        `}
    </div>`
}
