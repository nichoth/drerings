import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal, batch } from '@preact/signals'
import { Button } from '../components/button'
import { IconStamp } from '../components/icon-stamp'
import { State, type AppState, type SavedDrawing } from '../state'
import './send.css'

export const SendRoute:FunctionComponent<{
    state:AppState
}> = function SendRoute ({ state }) {
    const drawing = useSignal<SavedDrawing|null>(null)
    const error = useSignal<string>('')
    const isLoading = useSignal<boolean>(true)
    const isPublishing = useSignal<boolean>(false)
    const isSendingPostcard = useSignal<boolean>(false)
    const sendSuccess = useSignal<{
        email:string;
        balanceAfter:number;
    }|null>(null)
    const recipientEmail = useSignal<string>('')
    const idempotencyKey = useSignal<string|null>(null)
    const routePath = state.route.value.startsWith('/send/') ?
        state.route.value :
        location.pathname
    const drawingId = drawingIdFromPath(routePath)

    useEffect(() => {
        if (!drawingId) {
            isLoading.value = false
            error.value = 'Drawing not found.'
            return
        }

        isLoading.value = true
        error.value = ''

        State.FetchSavedDrawing(state, drawingId).then(saved => {
            drawing.value = saved
            state._setRoute(`/send/${encodeURIComponent(saved.id)}`)
            history.replaceState(null, '', `/send/${encodeURIComponent(
                saved.id
            )}`)
        }).catch(err => {
            error.value = err instanceof Error ?
                err.message :
                'Unable to load the drawing right now.'
        }).finally(() => {
            isLoading.value = false
        })
    }, [drawingId])

    const publish = useCallback(async () => {
        if (!drawing.value) return

        isPublishing.value = true
        error.value = ''

        try {
            const post = await State.PublishDrawing(state,
                drawing.value.id)
            const path = `/post/${post.id}`

            state._setRoute(path)
            history.pushState(null, '', path)
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to publish the drawing right now.'
        } finally {
            isPublishing.value = false
        }
    }, [])

    const sendPostcard = useCallback(async () => {
        if (!drawing.value) return

        batch(() => {
            isSendingPostcard.value = true
            error.value = ''
        })

        try {
            const key = idempotencyKey.value ??
                crypto.randomUUID()

            const result = await State.SendPostcard(state, {
                drawingId: drawing.value.id,
                recipientEmail: recipientEmail.value,
                idempotencyKey: key
            })

            if (result.ok) {
                batch(() => {
                    sendSuccess.value = {
                        email: recipientEmail.value,
                        balanceAfter: result.balanceAfter
                    }
                    recipientEmail.value = ''
                    idempotencyKey.value = null
                })
                return
            }

            if (result.reason === 'insufficient_stamps') {
                State.OpenBuyPackModal(state)
                batch(() => {
                    isSendingPostcard.value = false
                    recipientEmail.value = ''
                    idempotencyKey.value = null
                })
                return
            }

            error.value = result.message
        } catch (err) {
            error.value = err instanceof Error ?
                err.message :
                'Unable to send the postcard right now.'
        } finally {
            batch(() => {
                isSendingPostcard.value = false
                idempotencyKey.value = null
            })
        }
    }, [drawing])

    const resetSuccess = useCallback(() => {
        sendSuccess.value = null
        recipientEmail.value = ''
    }, [])

    return html`<div class="route send">
        <h2>Send drawing</h2>

        ${isLoading.value ? html`
            <p role="status">Loading drawing...</p>
        ` : null}

        ${error.value ? html`
            <p role="alert">${error.value}</p>
        ` : null}

        ${drawing.value ? html`
            <article class="send-preview">
                <img
                    src=${drawing.value.image}
                    alt=${drawing.value.alt_text}
                />
                <p>${drawing.value.text}</p>

                <div
                    class="send-actions"
                    role="group"
                    aria-label="Publish actions"
                >
                <${Button}
                    type="button"
                    onClick=${publish}
                    isSpinning=${isPublishing}
                >
                    Publish
                <//>
                </div>

                ${sendSuccess.value ? html`
                    <div class="send-success">
                        <p>Sent to ${sendSuccess.value.email}.
                            ${sendSuccess.value.balanceAfter}
                            stamps remaining.</p>
                        <${Button}
                            type="button"
                            onClick=${resetSuccess}
                        >
                            Send another
                        <//>
                    </div>
                ` : html`
                    <form class="send-postcard-form">
                        <div class="form-group">
                            <label htmlFor="recipient-email">
                                Recipient email
                            </label>
                            <input
                                id="recipient-email"
                                type="email"
                                value=${recipientEmail}
                                onChange=${(e:Event) => {
                                    const target =
                                        e.target as
                                        HTMLInputElement
                                    recipientEmail.value =
                                        target.value
                                }}
                                required
                            />
                        </div>

                        <div
                            class="send-postcard-actions"
                            role="group"
                            aria-label="Send postcard actions"
                        >
                            <${Button}
                                type="button"
                                onClick=${sendPostcard}
                                isSpinning=${isSendingPostcard}
                            >
                                Send postcard
                            <//>
                            <span
                                class="send-stamp-cost"
                                aria-label="Sending this postcard \
costs 1 stamp"
                            >
                                <${IconStamp} />
                                <span>1 stamp</span>
                            </span>
                        </div>
                    </form>
                `}
            </article>
        ` : null}
    </div>`
}

function drawingIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const sendIndex = parts.lastIndexOf('send')
    const id = parts[sendIndex + 1]

    return id ? decodeURIComponent(id) : null
}
