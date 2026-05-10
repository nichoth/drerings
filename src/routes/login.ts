import { html } from 'htm/preact'
import type { FunctionComponent } from 'preact'
import { useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { type AppState } from '../state.js'
import { Button } from '../components/button.js'
import './login.css'

export const LoginRoute:FunctionComponent<{ state:AppState }> = function () {
    const email = useSignal<string>('')
    const error = useSignal<string>('')
    const isSent = useSignal<boolean>(false)
    const isSending = useSignal<boolean>(false)

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
    </div>`
}
