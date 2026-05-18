import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button.js'
import { State, type AppState } from '../state.js'
import './account.css'

export const AccountRoute:FunctionComponent<{
    state:AppState;
}> = function AccountRoute ({ state }) {
    const currentUser = state.currentUser.value
    const returnStatus = new URLSearchParams(location.search).get('status')
    const account = state.account.value
    const error = useSignal<string>('')
    const message = useSignal<string>('')
    const confirmDelete = useSignal<boolean>(false)
    const deleteText = useSignal<string>('')

    useEffect(() => {
        if (!currentUser?.id) return

        State.FetchAccount(state).catch(() => {})
    }, [currentUser?.id, state])

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

        ${returnStatus === 'cancel' ?
                html`<p class="account-note">
                    Checkout was canceled. You can restart from pricing.
                </p>` :
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
                    <dt>Bluesky Handle</dt>
                    <dd>${account?.handle || currentUser?.handle || ''}</dd>
                </dl>
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
}

function inputValue (ev:InputEvent):string {
    const target = ev.target as HTMLInputElement|null

    return target?.value || ''
}
