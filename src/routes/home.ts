import { html } from 'htm/preact'
import { useRef, useEffect, useCallback } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament, { MODE_DRAW, MODE_ERASE } from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import '@substrate-system/check-box'
import '@substrate-system/check-box/css'
import { useComputed, useSignal } from '@preact/signals'
import { ELLIPSIS } from '../constants'
import {
    atUriToBskyUrl,
    BSKY_WEB_ORIGIN,
    canvasToSquareBlob
} from '../util'
import './home.css'
import { State, type AppState } from '../state'
import { Button, LinkBtn } from '../components/button'
import { ColorPicker } from '../components/color-picker'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:view')

let atrament:Atrament
const DEFAULT_BRUSH_COLOR = '#000000'
const DEFAULT_BRUSH_SIZE = 4
const MIN_BRUSH_SIZE = 1
const MAX_BRUSH_SIZE = 40

export const HomeRoute:FunctionComponent<{
    state:AppState
}> = function HomeRoute ({ state }) {
    const sketchpad = useRef<HTMLCanvasElement>(null)
    const isCanvasDirty = useSignal<boolean>(false)
    const brushColor = useSignal<string>(DEFAULT_BRUSH_COLOR)
    const brushSize = useSignal<number>(DEFAULT_BRUSH_SIZE)
    const isEraserEnabled = useSignal<boolean>(false)

    useEffect(() => {
        debug('sketchpad.current...', sketchpad.current)
        debug('atrament current...', atrament)
        if (!sketchpad.current) return
        const canvas = sketchpad.current
        const side = Math.max(1, Math.floor(
            Math.min(canvas.offsetWidth, canvas.offsetHeight)
        ))
        atrament = new Atrament(sketchpad.current, {
            width: side,
            height: side,
            ignoreModifiers: true,
            weight: brushSize.value,
            fill
        })

        atrament.smoothing = 0.7
        atrament.color = brushColor.value
        atrament.addEventListener('dirty', () => {
            isCanvasDirty.value = true
        })
        atrament.addEventListener('clean', () => {
            isCanvasDirty.value = false
        })

        return () => {
            atrament.destroy()
        }
    }, [sketchpad.current])

    const onColorChange = useCallback((nextColor:string) => {
        brushColor.value = nextColor
        if (atrament) atrament.color = nextColor
    }, [])

    const onSizeChange = useCallback((ev:Event) => {
        const target = ev.target as HTMLInputElement
        const nextSize = Number(target.value)
        if (!Number.isFinite(nextSize)) return
        brushSize.value = nextSize
    }, [])

    const onEraserChange = useCallback((ev:Event) => {
        const target = ev.target as (EventTarget & { checked?:boolean })|null
        if (!target || typeof target.checked !== 'boolean') return
        isEraserEnabled.value = target.checked
    }, [])

    useEffect(() => {
        if (atrament) {
            atrament.weight = brushSize.value
        }
    }, [brushSize.value])

    useEffect(() => {
        if (atrament) {
            atrament.mode = isEraserEnabled.value ? MODE_ERASE : MODE_DRAW
        }
    }, [isEraserEnabled.value])

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
                <div>
                    <label for="text">Text</label>
                    <textarea
                        id="text"
                        name="text"
                        disabled=${
                            !state.isAuthed.value || !isCanvasDirty.value
                        }
                        class="post-text"
                        placeholder="My text message${ELLIPSIS}"
                    ></textarea>
                </div>

                <div class="alt-text-field">
                    <label for="alt-text">Alt text</label>
                    <textarea
                        id="alt-text"
                        name="alt-text"
                        disabled=${
                            !state.isAuthed.value || !isCanvasDirty.value
                        }
                        class="alt-text"
                        placeholder=${
                            "Describe your drawing for people who can't " +
                            `see it${ELLIPSIS}`
                        }
                    ></textarea>
                </div>

                <div class="brush-size-wrap">
                    <label for="brush-size">Brush size</label>
                    <div class="brush-size-row">
                        <input
                            id="brush-size"
                            type="range"
                            min=${MIN_BRUSH_SIZE}
                            max=${MAX_BRUSH_SIZE}
                            step="1"
                            value=${brushSize.value}
                            disabled=${isPosting.value}
                            onInput=${onSizeChange}
                            onChange=${onSizeChange}
                        />
                        <output for="brush-size">${brushSize.value}</output>
                    </div>
                </div>

                <div class="eraser-wrap">
                    <check-box
                        class="eraser"
                        name="eraser"
                        disabled=${isPosting.value ? true : undefined}
                        onChange=${onEraserChange}
                        onInput=${onEraserChange}
                    >
                        Eraser
                    </check-box>
                </div>

                <div class="color-picker-wrap">
                    <${ColorPicker}
                        id="brush-color"
                        value=${brushColor.value}
                        onChange=${onColorChange}
                        disabled=${isPosting.value}
                    />
                </div>

                <div class="controls">
                    ${state.isAuthed.value ?
                        html`<${Button}
                            type="submit"
                            isSpinning=${isPosting}
                            disabled=${disable.value}
                        >
                            Post It
                        <//>` :
                        html`<${LinkBtn}
                            href="/login"
                            disabled=${state.authLoading.value}
                        >
                            Login
                        <//>
                        `
                    }
                </div>
                ${!state.isAuthed.value ? html`
                    <p class="create-account-link">
                        Need a Bluesky account? <a
                            href="${BSKY_WEB_ORIGIN}"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Create one
                        </a>.
                    </p>
                ` : null}
                ${postError.value && html`
                    <p class="error-banner">${postError.value}</p>
                `}
                ${postSuccess.value && html`
                    <p class="success-banner">Posted to Bluesky.</p>
                    ${postUrl.value && html`<p class="success-link">
                        <a
                            href="${postUrl.value}"
                            target="_blank"
                            rel="noreferrer"
                        >
                            View on Bluesky
                        </a>
                    </p>`}
                `}
            </form>
        </div>
    </div>`
}
