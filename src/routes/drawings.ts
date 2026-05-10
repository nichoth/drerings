import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import { State, type AppState, type SavedDrawing } from '../state'
import './drawings.css'

export const DrawingsRoute:FunctionComponent<{
    state:AppState
}> = function DrawingsRoute ({ state }) {
    const currentUser = state.currentUser.value
    const openError = useSignal<string>('')
    const deleteError = useSignal<string>('')

    useEffect(() => {
        if (!currentUser) return

        State.FetchSavedDrawings(state).catch(() => {})
    }, [currentUser?.id])

    const openDrawing = useCallback(async (drawing:SavedDrawing) => {
        openError.value = ''

        try {
            await State.OpenSavedDrawing(state, drawing.id)
        } catch (err) {
            openError.value = err instanceof Error ?
                err.message :
                'Unable to open the drawing right now.'
        }
    }, [])

    const deleteDrawing = useCallback(async (drawing:SavedDrawing) => {
        deleteError.value = ''

        if (!window.confirm('Delete this saved drawing?')) return

        try {
            await State.DeleteSavedDrawing(state, drawing.id)
        } catch (err) {
            deleteError.value = err instanceof Error ?
                err.message :
                'Unable to delete the drawing right now.'
        }
    }, [])

    if (!currentUser) {
        return html`<div class="route drawings">
            <h2>Saved drawings</h2>
            <p><a href="/login">Sign in</a> to see your saved drawings.</p>
        </div>`
    }

    return html`<div class="route drawings">
        <div class="drawings-heading">
            <h2>Saved drawings</h2>
            <a href="/">New drawing</a>
        </div>

        ${state.savedDrawingsLoading.value ? html`
            <p role="status">Loading drawings...</p>
        ` : null}

        ${state.savedDrawingsError.value ? html`
            <p role="alert">${state.savedDrawingsError.value}</p>
        ` : null}

        ${openError.value ? html`
            <p role="alert">${openError.value}</p>
        ` : null}

        ${deleteError.value ? html`
            <p role="alert">${deleteError.value}</p>
        ` : null}

        ${state.savedDrawings.value.length === 0 &&
            !state.savedDrawingsLoading.value ? html`
                <p>No saved drawings yet.</p>
            ` : html`
                <ul class="saved-drawings-list" aria-label="Saved drawings">
                    ${state.savedDrawings.value.map(drawing => {
                        return html`<li>
                            <article class="saved-drawing">
                                <img
                                    src=${drawing.image}
                                    alt=${drawing.alt_text}
                                />
                                <div class="saved-drawing-body">
                                    <p class="saved-drawing-text">
                                        ${drawing.text}
                                    </p>
                                    <p class="saved-drawing-date">
                                        ${drawing.updated_at}
                                    </p>
                                    <div class="saved-drawing-actions">
                                        <${Button}
                                            type="button"
                                            onClick=${() => {
                                                return openDrawing(drawing)
                                            }}
                                        >
                                            Open
                                        <//>
                                        <${Button}
                                            type="button"
                                            onClick=${() => {
                                                return deleteDrawing(drawing)
                                            }}
                                        >
                                            Delete
                                        <//>
                                    </div>
                                </div>
                            </article>
                        </li>`
                    })}
                </ul>
            `}
    </div>`
}
