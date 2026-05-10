import { html } from 'htm/preact'
import type { FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
    browserSupportsWebAuthn,
    startAuthentication
} from '@simplewebauthn/browser'
import { type AppState } from '../state.js'
import { Button } from '../components/button.js'
import './login.css'

export const LoginRoute:FunctionComponent<{
    state:AppState;
}> = function ({ state }) {
    const email = useSignal<string>('')
    const error = useSignal<string>('')
    const isSent = useSignal<boolean>(false)
    const isSending = useSignal<boolean>(false)
    const passkeyError = useSignal<string>('')
    const passkeySending = useSignal<boolean>(false)
    const supportsPasskeys = browserSupportsWebAuthn()

    const submit = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        error.value = ''
        isSending.value = true

        try {
            const response = await fetch('/api/auth/magic-link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: email.value })
            })

            if (!response.ok) {
                const body = await response.json().catch(() => ({}))
                throw new Error(body.error || 'Unable to send link.')
            }

            isSent.value = true
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to send link.'
        } finally {
            isSending.value = false
        }
    }, [])

    const signInWithPasskey = useCallback(async () => {
        passkeyError.value = ''
        passkeySending.value = true

        try {
            const optionsResponse = await fetch(
                '/api/auth/passkey/login/options',
                { method: 'POST' }
            )

            if (!optionsResponse.ok) {
                const body = await optionsResponse.json().catch(() => ({}))
                throw new Error(body.error || 'Unable to start passkey.')
            }

            const optionsBody = await optionsResponse.json()
            const response = await startAuthentication({
                optionsJSON: optionsBody.options
            })
            const verifyResponse = await fetch(
                '/api/auth/passkey/login/verify',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        challenge_token: optionsBody.challenge_token,
                        response
                    })
                }
            )

            if (!verifyResponse.ok) {
                const body = await verifyResponse.json().catch(() => ({}))
                throw new Error(body.error || 'Passkey sign-in failed.')
            }

            state.auth.value = {
                registered: true,
                authenticated: true
            }
        } catch (err) {
            passkeyError.value = err instanceof Error ?
                err.message :
                'Passkey sign-in failed.'
        } finally {
            passkeySending.value = false
        }
    }, [state])

    return html`<div class="route login">
        <h2>Sign In</h2>

        ${isSent.value ?
            html`<p>
                Check your email for a sign-in link.
            </p>` :
            html`<form onSubmit=${submit}>
                <div class="input">
                    <label for="email">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autocomplete="email"
                        required
                        value=${email.value}
                        onInput=${(ev:InputEvent) => {
                            const input = ev.currentTarget as HTMLInputElement
                            email.value = input.value
                        }}
                    />
                </div>

                ${error.value ?
                    html`<p role="alert" class="login-error">
                        ${error.value}
                    </p>` :
                    null
                }

                <${Button}
                    type="submit"
                    isSpinning=${isSending}
                >
                    Send link
                <//>
            </form>`
        }

        ${supportsPasskeys ?
            html`<div class="login-passkey">
                <${Button}
                    type="button"
                    onClick=${signInWithPasskey}
                    isSpinning=${passkeySending}
                >
                    Sign in with passkey
                <//>

                ${passkeyError.value ?
                    html`<p role="alert" class="login-error">
                        ${passkeyError.value}
                    </p>` :
                    null
                }
            </div>` :
            null
        }
    </div>`
}
