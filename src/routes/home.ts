import { html } from 'htm/preact'
import { useRef, useEffect, useCallback, useMemo } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import { useComputed, useSignal } from '@preact/signals'
import { ELLIPSIS } from '../constants'
import { atUriToBskyUrl } from '../util'
import './home.css'
import { State, type AppState } from '../state'
import { Button, LinkBtn } from '../components/button'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:view')

export const HomeRoute:FunctionComponent<{
    state:AppState
}> = function HomeRoute ({ state }) {
    const sketchpad = useRef<HTMLCanvasElement>(null)
    const isCanvasDirty = useSignal<boolean>(false)
    const atrament = useMemo(() => {
        if (!sketchpad.current) return
        const canvas = sketchpad.current
        const side = Math.max(1, Math.floor(
            Math.min(canvas.offsetWidth, canvas.offsetHeight)
        ))
        return new Atrament(sketchpad.current, {
            width: side,
            height: side,
            ignoreModifiers: true,
            fill
        })
    }, [sketchpad.current])

    useEffect(() => {
        debug('sketchpad.current', sketchpad.current)
        if (!atrament) return

        atrament.smoothing = 0.7
        atrament.addEventListener('dirty', () => {
            isCanvasDirty.value = true
        })
        atrament.addEventListener('clean', () => {
            isCanvasDirty.value = false
        })
    }, [sketchpad.current])

    const disable = useComputed<boolean>(() => {
        return (
            state.postReq.value.pending ||
            (state.isAuthed.value && !isCanvasDirty.value)
        )
    })

    const postError = useComputed<string|null>(() => {
        return state.postReq.value.error?.message || null
    })

    const postSuccess = useComputed<boolean>(() => {
        return !!state.postReq.value.data && !state.postReq.value.pending
    })
    const postUrl = useComputed<string|null>(() => {
        const atUri = state.postReq.value.data?.uri
        if (!atUri) return null

        try {
            return atUriToBskyUrl(atUri)
        } catch (err) {
            debug('failed to parse post uri', err)
            return null
        }
    })
    const isPosting = useComputed<boolean>(() => state.postReq.value.pending)

    const login = useCallback((ev:SubmitEvent) => {
        ev.preventDefault()
        debug('logging in...')
        state._setRoute('/login')
    }, [])

    const submitDrering = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (state.postReq.value.pending) return
        const form = ev.target as HTMLFormElement
        const textarea = form.elements['text'] as HTMLTextAreaElement
        const altInput = form.elements['alt-text'] as HTMLTextAreaElement
        const text = textarea.value.trim()
        const altText = altInput.value.trim()
        const canvas = sketchpad.current

        try {
            if (!canvas) throw new Error('Drawing canvas not found')
            const imageBlob = await canvasToSquareBlob(canvas, 'image/png')
            await State.post(state, text, imageBlob, altText)
            textarea.value = ''
            altInput.value = ''
            if (atrament) atrament.clear()
        } catch (err) {
            debug('submit drering error', err)
        }
    }, [])

    return html`<div class="route home">
        <p>
            Draw things, then show people the drawings.
        </p>

        <div class="composer-layout">
            <div class="canvas-column">
                <canvas ref=${sketchpad} id="sketchpad"></canvas>
            </div>

            <form onSubmit=${state.isAuthed.value ? submitDrering : login}>
                <label for="text">Text</label>
                <textarea
                    id="text"
                    name="text"
                    class="post-text"
                    placeholder="My text message${ELLIPSIS}"
                ></textarea>

                ${state.isAuthed.value && html`<div class="alt-text-field">
                    <label for="alt-text">Alt text</label>
                    <textarea
                        id="alt-text"
                        name="alt-text"
                        class="alt-text"
                        placeholder="Describe your drawing for people who can't see it${ELLIPSIS}"
                    ></textarea>
                </div>`}

                <div class="controls">
                    ${state.isAuthed.value ?
                        html`<${Button}
                            type="submit"
                            isSpinning=${isPosting}
                            disabled=${disable}
                        >
                            Post It
                        <//>` :
                        html`<${LinkBtn} href="/login">
                            Login
                        <//>
                        `
                    }
                </div>
                ${postError.value && html`<p class="error-banner">${postError.value}</p>`}
                ${postSuccess.value && html`
                    <p class="success-banner">Posted to Bluesky.</p>
                    ${postUrl.value && html`<p class="success-link">
                        <a href="${postUrl.value}" target="_blank" rel="noreferrer">
                            View on Bluesky
                        </a>
                    </p>`}
                `}
            </form>
        </div>
    </div>`
}

function canvasToSquareBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    if (canvas.width === canvas.height) {
        return canvasToBlob(canvas, type)
    }

    const side = Math.max(canvas.width, canvas.height)
    const squareCanvas = document.createElement('canvas')
    squareCanvas.width = side
    squareCanvas.height = side

    const context = squareCanvas.getContext('2d')
    if (!context) {
        return Promise.reject(new Error('Could not create square image context'))
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, side, side)
    const x = Math.floor((side - canvas.width) / 2)
    const y = Math.floor((side - canvas.height) / 2)
    context.drawImage(canvas, x, y)

    return canvasToBlob(squareCanvas, type)
}

function canvasToBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Could not encode drawing image'))
            resolve(blob)
        }, type)
    })
}
