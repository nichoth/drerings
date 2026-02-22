import { html } from 'htm/preact'
import { useCallback } from 'preact/hooks'
import type { FunctionComponent } from 'preact'
import { useComputed, useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { RequestState, type RequestFor } from '@substrate-system/state'
import { Button } from '../components/button.js'
// import { Input } from '../components/input.js'
import { PasswordInput } from '@substrate-system/password-input'
import '@substrate-system/password-input/css'
import { State } from '../state.js'
import type { AppState } from '../state.js'
import './login.css'

const debug = Debug('drerings:login')

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
    const secret = useSignal('')
    const submitting = useSignal<RequestFor<null, Error>>(RequestState(null))
    const error = useSignal<string|null>(null)
    const success = useSignal<string|null>(null)
    const isSubmitting = useComputed<boolean>(() => submitting.value.pending)

    const handleRegister = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (!secret.value.trim() || submitting.value.pending) return

        RequestState.start(submitting)
        error.value = null
        success.value = null

        try {
            await State.register(state, secret.value)
            secret.value = ''
            success.value = 'Passkey registered successfully!'

            // Redirect to home after successful registration
            setTimeout(() => {
                state._setRoute('/')
            }, 1000)

            RequestState.set(submitting, null)
        } catch (err) {
            debug('registration error', err)
            RequestState.error(submitting, err as Error)
            error.value = await getErrorMessage(err, 'Registration failed')
        }
    }, [])

    const handleLogin = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (submitting.value.pending) return

        RequestState.start(submitting)
        error.value = null
        success.value = null

        try {
            await State.login(state)
            success.value = 'Logged in successfully!'

            // Redirect to home after successful login
            setTimeout(() => {
                state._setRoute('/')
            }, 500)

            RequestState.set(submitting, null)
        } catch (err) {
            debug('auth error', err)
            RequestState.error(submitting, err as Error)
            error.value = await getErrorMessage(err, 'Authentication failed')
        }
    }, [])

    const auth = state.auth.value

    // If already authenticated, show message
    if (auth?.authenticated) {
        return html`<div class="route login">
            <h2>Login</h2>
            <p class="already-authenticated">
                You are already logged in. <a href="/">Go to Dashboard</a>
            </p>
        </div>`
    }

    const isRegistered = auth?.registered ?? false

    return html`<div class="route login">
        <h2>Login</h2>

        ${error.value && html`<p class="error-banner">${error.value}</p>`}
        ${success.value && html`<p class="success-message">${success.value}</p>`}

        ${isRegistered ? html`
            <section class="login-section">
                <header>
                    <h3>Login with Passkey</h3>
                    <p>Use your registered passkey to authenticate.</p>
                </header>

                <form onSubmit=${handleLogin}>
                    <div class="controls">
                        <${Button}
                            type="submit"
                            isSpinning=${isSubmitting}
                        >
                            Login with Passkey
                        <//>
                    </div>
                </form>
            </section>

            <section class="add-passkey-section">
                <header>
                    <h3>Add Another Passkey</h3>
                    <p>Register an additional device or passkey.</p>
                </header>

                <form onSubmit=${handleRegister}>
                    <div class="input">
                        <label for="secret">Registration Secret</label>
                        <${Input}
                            type="password"
                            id="secret"
                            name="secret"
                            placeholder="abc123..."
                            value=${secret.value}
                            onInput=${(e:Event) => {
                                secret.value = (e.target as HTMLInputElement).value
                            }}
                            disabled=${isSubmitting.value}
                        />
                    </div>
                    <div class="controls">
                        <${Button}
                            type="submit"
                            isSpinning=${isSubmitting}
                            disabled=${!secret.value.trim()}
                        >
                            Add Passkey
                        <//>
                    </div>
                </form>
            </section>
        ` : html`
            <section class="register-section">
                <header>
                    <h3>Register a Passkey</h3>
                    <p>Enter the registration secret to set up your passkey.</p>
                </header>

                <form onSubmit=${handleRegister}>
                    <div class="input">
                        <label for="secret">Password</label>
                        <${PasswordInput.TAG}
                            id="secret"
                            name="secret"
                            autocomplete="new-password"
                            placeholder="abc123..."
                            value=${secret.value}
                            onInput=${(e:Event) => {
                                debug('input ev')
                                secret.value = (e.target as HTMLInputElement).value
                            }}
                            disabled=${isSubmitting.value}
                        />
                    </div>
                    <div class="controls">
                        <${Button}
                            type="submit"
                            isSpinning=${isSubmitting}
                            disabled=${!secret.value.trim()}
                        >
                            Register Passkey
                        <//>
                    </div>
                </form>
            </section>
        `}
    </div>`
}
