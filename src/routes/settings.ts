import { html } from 'htm/preact'
import type { FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
    browserSupportsWebAuthn,
    startRegistration
} from '@simplewebauthn/browser'
import { type AppState } from '../state.js'
import { Button } from '../components/button.js'
import './settings.css'

export const SettingsRoute:FunctionComponent<{
    state:AppState;
}> = function ({ state }) {
    const error = useSignal<string>('')
    const status = useSignal<string>('')
    const isRegistering = useSignal<boolean>(false)
    const supportsPasskeys = browserSupportsWebAuthn()

    const registerPasskey = useCallback(async () => {
        error.value = ''
        status.value = ''
        isRegistering.value = true

        try {
            const optionsResponse = await fetch(
                '/api/auth/passkey/register/options',
                { method: 'POST' }
            )

            if (!optionsResponse.ok) {
                const body = await optionsResponse.json().catch(() => ({}))
                throw new Error(body.error || 'Unable to start passkey.')
            }

            const optionsBody = await optionsResponse.json()
            const response = await startRegistration({
                optionsJSON: optionsBody.options
            })
            const verifyResponse = await fetch(
                '/api/auth/passkey/register/verify',
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
                throw new Error(body.error || 'Passkey registration failed.')
            }

            state.auth.value = {
                registered: true,
                authenticated: true
            }
            status.value = 'Passkey registered.'
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Passkey registration failed.'
        } finally {
            isRegistering.value = false
        }
    }, [state])

    return html`<div class="route settings">
        <h2>Settings</h2>

        ${state.isAuthed.value ?
            html`<section>
                <h3>Passkeys</h3>

                ${supportsPasskeys ?
                    html`<${Button}
                        type="button"
                        onClick=${registerPasskey}
                        isSpinning=${isRegistering}
                    >
                        Register a passkey
                    <//>` :
                    html`<p>
                        Passkeys are not available in this browser.
                    </p>`
                }

                ${status.value ?
                    html`<p class="settings-success">${status.value}</p>` :
                    null
                }

                ${error.value ?
                    html`<p role="alert" class="settings-error">
                        ${error.value}
                    </p>` :
                    null
                }
            </section>` :
            html`<p>
                <a href="/login">Sign in</a> to manage your account.
            </p>`
        }
    </div>`
}
