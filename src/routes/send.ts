import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
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
            const post = await State.PublishDrawing(state, drawing.value.id)
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
                    aria-label="Send actions"
                >
                    <${Button}
                        type="button"
                        onClick=${publish}
                        isSpinning=${isPublishing}
                    >
                        Publish
                    <//>
                    <span
                        class="send-stamp-cost"
                        aria-label="Sending this postcard costs 1 stamp"
                    >
                        <${IconStamp} />
                        <span>1 stamp</span>
                    </span>
                </div>
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
