import { html } from 'htm/preact'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { FunctionComponent } from 'preact'
import { useComputed, useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { SubstrateInput } from '@substrate-system/input'
import '@substrate-system/input/css'
import { Button } from '../components/button.js'
import {
    RequestState,
    State,
    type AppState,
    type RequestFor
} from '../state.js'
import './login.css'
import { hasOAuthCallback, readOAuthParamsFromLocation } from '../util.js'

const debug = Debug('drerings:login')

export const LoginRoute:FunctionComponent<{ state:AppState }> = function ({
    state
}) {
    const handle = useSignal('')
    const request = useSignal<RequestFor<string|null, Error>>(
        RequestState<string|null>(null)
    )
    const isSubmitting = useComputed<boolean>(() => request.value.pending)
    const errorMessage = useComputed<string|null>(() => {
        return request.value.error?.message || null
    })
    const successMessage = useComputed<string|null>(() => request.value.data)
    const callbackHandled = useRef(false)

    useEffect(() => {
        // Keep host consistent with Bluesky local OAuth callback requirements.
        if (window.location.hostname === 'localhost') {
            const redirectUrl = new URL(window.location.href)
            redirectUrl.hostname = '127.0.0.1'
            window.location.replace(redirectUrl.toString())
            return
        }

        const query = readOAuthParamsFromLocation()
        if (!hasOAuthCallback(query) || callbackHandled.current) return

        callbackHandled.current = true

        const oauthError = State.readOAuthError(query)
        if (oauthError) {
            RequestState.error(request, new Error(oauthError))
            State.clearOAuthQuery()
            return
        }

        RequestState.start(request)

        const finishOAuth = async ():Promise<void> => {
            try {
                await State.finishOAuth(state, query)
                RequestState.set(request, 'Signed in with Bluesky')
                State.clearOAuthQuery()

                setTimeout(() => {
                    state._setRoute('/')
                }, 350)
            } catch (err) {
                debug('oauth callback error', err)
                const message = await getErrorMessage(err, 'OAuth login failed')
                RequestState.error(request, new Error(message))
            }
        }

        finishOAuth()
    }, [state.route.value])

    const startOAuth = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (request.value.pending) return

        const normalizedHandle = handle.value.trim()
        if (!normalizedHandle) {
            RequestState.error(request, new Error('Enter your Bluesky handle'))
            return
        }

        RequestState.start(request)

        try {
            await State.login(state, normalizedHandle)
            RequestState.set(request, null)
        } catch (err) {
            debug('oauth start error', err)
            const message = await getErrorMessage(
                err,
                'Unable to start OAuth login'
            )
            RequestState.error(request, new Error(message))
        }
    }, [])

    const auth = state.auth.value
    const callbackQuery = readOAuthParamsFromLocation()
    const isOAuthCallback = hasOAuthCallback(callbackQuery)

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

        ${errorMessage.value &&
            html`<p class="error-banner">${errorMessage.value}</p>`}
        ${successMessage.value &&
            html`<p class="success-message">${successMessage.value}</p>`}

        ${isOAuthCallback && isSubmitting.value ? html`
            <p class="login-status">Completing Bluesky login...</p>
        ` : html`
            <form class="login-form" onSubmit=${startOAuth}>
                <${SubstrateInput.TAG}
                    label="Bluesky Handle"
                    id="bsky-handle"
                    placeholder="alice.bsky.app"
                    value=${handle.value}
                    onInput=${(ev:Event) => {
                        handle.value = (ev.target as HTMLInputElement).value
                    }}
                    disabled=${isSubmitting.value}
                    autocomplete="username"
                ><//>

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
