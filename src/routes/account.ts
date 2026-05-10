import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
    browserSupportsWebAuthn,
    startRegistration
} from '@simplewebauthn/browser'
import { State, type AccountDetails, type AppState } from '../state.js'
import { Button } from '../components/button.js'
import './account.css'

export const AccountRoute:FunctionComponent<{
    state:AppState;
}> = function AccountRoute ({ state }) {
    const currentUser = state.currentUser.value
    const returnStatus = new URLSearchParams(location.search).get('status')
    const emailStatus = new URLSearchParams(location.search).get('email')
    const account = state.account.value
    const error = useSignal<string>('')
    const message = useSignal<string>('')
    const newEmail = useSignal<string>('')
    const confirmDelete = useSignal<boolean>(false)
    const deleteText = useSignal<string>('')
    const supportsPasskeys = browserSupportsWebAuthn()

    useEffect(() => {
        if (!currentUser?.id) return

        State.FetchAccount(state).catch(() => {})
    }, [currentUser?.id, state])

    const updateEmail = useCallback(async () => {
        error.value = ''
        message.value = ''

        try {
            await State.RequestEmailUpdate(state, newEmail.value)
            message.value = `Check ${newEmail.value} to confirm the update.`
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to send the update link right now.'
        }
    }, [state])

    const registerPasskey = useCallback(async () => {
        error.value = ''
        message.value = ''

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

            message.value = 'Passkey registered.'
            await State.FetchAccount(state)
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Passkey registration failed.'
        }
    }, [state])

    const removePasskey = useCallback(async (passkeyId:string) => {
        error.value = ''
        message.value = ''

        try {
            await State.RemovePasskey(state, passkeyId)
            message.value = 'Passkey removed.'
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to remove passkey right now.'
        }
    }, [state])

    const cancelSubscription = useCallback(async () => {
        error.value = ''
        message.value = ''

        try {
            await State.CancelSubscription(state)
            message.value = 'Subscription will end at period close.'
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to cancel subscription right now.'
        }
    }, [state])

    const deleteAccount = useCallback(async () => {
        if (!confirmDelete.value) {
            confirmDelete.value = true
            return
        }

        error.value = ''
        message.value = ''

        if (deleteText.value !== 'DELETE') {
            error.value = 'Type DELETE to confirm.'
            return
        }

        try {
            await State.DeleteAccount(state)
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to delete account right now.'
        }
    }, [state])

    return html`<div class="route account">
        <h2>Account</h2>

        ${returnStatus === 'ok' ?
                html`<p class="account-success">
                    Your subscription is being activated.
                </p>` :
                null
            }

        ${returnStatus === 'cancel' ?
                html`<p class="account-note">
                    Checkout was canceled. You can restart from pricing.
                </p>` :
                null
            }

        ${emailStatus === 'ok' ?
            html`<p class="account-success">Email updated.</p>` :
            null
        }

        ${!currentUser ?
            html`<p>
                <a href="/login">Sign in</a> to manage your account.
            </p>` :
            accountView()
        }
    </div>`

    function accountView () {
        return html`
            ${state.accountError.value ?
                html`<p role="alert" class="account-error">
                    ${state.accountError.value}
                </p>` :
                null
            }

            ${error.value ?
                html`<p role="alert" class="account-error">
                    ${error.value}
                </p>` :
                null
            }

            ${message.value ?
                html`<p role="status" class="account-success">
                    ${message.value}
                </p>` :
                null
            }

            <section aria-label="Profile" class="account-section">
                <h3>Profile</h3>
                <dl>
                    <dt>Email</dt>
                    <dd>${account?.email || currentUser?.email || ''}</dd>
                </dl>
                <label>
                    New email
                    <input
                        type="email"
                        value=${newEmail.value}
                        onInput=${(ev:InputEvent) => {
                            newEmail.value = inputValue(ev)
                        }}
                    />
                </label>
                <${Button} type="button" onClick=${updateEmail}>
                    Update email
                <//>
            </section>

            <section aria-label="Subscription" class="account-section">
                <h3>Subscription</h3>
                <p>${subscriptionLabel(account)}</p>
                ${returnStatus === 'cancel' ?
                    html`<p class="account-note">
                        Checkout was canceled. You can restart from pricing.
                    </p>` :
                    null
                }
                <${Button}
                    type="button"
                    onClick=${cancelSubscription}
                    disabled=${account?.subscription_status !== 'active'}
                >
                    Cancel subscription
                <//>
            </section>

            <section aria-label="Passkeys" class="account-section">
                <h3>Passkeys</h3>
                ${passkeyList(account)}
                ${supportsPasskeys ?
                    html`<${Button}
                        type="button"
                        onClick=${registerPasskey}
                    >
                        Register new passkey
                    <//>` :
                    html`<p>Passkeys are not available in this browser.</p>`
                }
            </section>

            <section aria-label="Danger zone" class="account-section">
                <h3>Danger zone</h3>
                ${confirmDelete.value ?
                    html`<div class="account-delete-confirm">
                        <p>Type DELETE to confirm</p>
                        <label>
                            Confirmation
                            <input
                                value=${deleteText.value}
                                onInput=${(ev:InputEvent) => {
                                    deleteText.value = inputValue(ev)
                                }}
                            />
                        </label>
                        <${Button} type="button" onClick=${deleteAccount}>
                            Confirm delete
                        <//>
                    </div>` :
                    html`<${Button} type="button" onClick=${deleteAccount}>
                        Delete account
                    <//>`
                }
            </section>
        `
    }

    function passkeyList (details:AccountDetails|null) {
        if (!details?.passkeys.length) return html`<p>No passkeys yet.</p>`

        return html`<ul class="account-passkeys">
            ${details.passkeys.map((passkey) => {
                return html`<li key=${passkey.id}>
                    <span>Added ${formatDate(passkey.created_at)}</span>
                    <${Button}
                        type="button"
                        onClick=${() => removePasskey(passkey.id)}
                    >
                        Remove
                    <//>
                </li>`
            })}
        </ul>`
    }
}

function subscriptionLabel (account:AccountDetails|null):string {
    const status = account?.subscription_status || 'free'
    const end = account?.subscription_current_period_end

    if (status === 'active') {
        return end ? `Active - renews ${end}` : 'Active'
    }

    if (status === 'canceled') {
        return end ? `Canceled - ends ${end}` : 'Canceled'
    }

    if (status === 'past_due') return 'Past due'

    return 'Free'
}

function formatDate (value:string):string {
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) return value

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date)
}

function inputValue (ev:InputEvent):string {
    const target = ev.target as HTMLInputElement|null

    return target?.value || ''
}
