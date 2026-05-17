import { html } from 'htm/preact'
import { useRef, useEffect, useCallback } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament, { MODE_DRAW, MODE_ERASE } from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import '@substrate-system/check-box'
import '@substrate-system/check-box/css'
import { CharacterCounter } from '@substrate-system/character-counter'
import '@substrate-system/character-counter/css'
import { useComputed, useSignal } from '@preact/signals'
import { ELLIPSIS } from '../constants'
import { countGraphemes, TEXT_INPUT_MAX } from '../post-text'
import './home.css'
import { State, type AppState } from '../state'
import { Button } from '../components/button'
import { ColorPicker } from '../components/color-picker'
import { BuyPackModal } from '../components/buy-pack-modal'
import Debug from '@substrate-system/debug'

const debug = Debug('drerings:view')

let atrament:Atrament
const DEFAULT_BRUSH_COLOR = '#000000'
const DEFAULT_BRUSH_SIZE = 4
const MIN_BRUSH_SIZE = 1
const MAX_BRUSH_SIZE = 40
const ALT_TEXT_MAX = 2000

export const HomeRoute:FunctionComponent<{
    state:AppState
}> = function HomeRoute ({ state }) {
    const sketchpad = useRef<HTMLCanvasElement>(null)
    const brushColor = useSignal<string>(DEFAULT_BRUSH_COLOR)
    const brushSize = useSignal<number>(DEFAULT_BRUSH_SIZE)
    const isEraserEnabled = useSignal<boolean>(false)
    const openedDrawing = state.currentDrawing.value
    const text = useSignal<string>(openedDrawing?.text || '')
    const altText = useSignal<string>(openedDrawing?.alt_text || '')
    const saveStatus = useSignal<'idle'|'saving'|'saved'|'error'>('idle')
    const saveError = useSignal<string>('')
    const isSaving = useComputed<boolean>(() => saveStatus.value === 'saving')

    useEffect(() => {
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

        return () => {
            atrament.destroy()
        }
    }, [])

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

    const onTextInput = useCallback((ev:Event) => {
        const target = ev.target as HTMLTextAreaElement
        text.value = target.value
    }, [])

    const onAltTextInput = useCallback((ev:Event) => {
        const target = ev.target as HTMLTextAreaElement
        altText.value = target.value
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

    useEffect(() => {
        if (!openedDrawing) return

        text.value = openedDrawing.text
        altText.value = openedDrawing.alt_text

        const canvas = sketchpad.current
        if (!canvas || !openedDrawing.image) return

        const image = new Image()
        image.onload = () => {
            const context = canvas.getContext('2d')
            if (!context) return
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
        }
        image.src = openedDrawing.image
    }, [openedDrawing?.id])

    const textCount = useComputed<number>(() => {
        return countGraphemes(text.value)
    })
    const altTextCount = useComputed<number>(() => {
        return countGraphemes(altText.value)
    })
    const hasInvalidText = useComputed<boolean>(() => {
        return textCount.value > TEXT_INPUT_MAX ||
            altTextCount.value > ALT_TEXT_MAX
    })
    const paidActionsDisabled = useComputed<boolean>(() => {
        return !state.isAuthed.value || hasInvalidText.value
    })

    const submitDrawing = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        if (!state.isAuthed.value || hasInvalidText.value) return
        const canvas = sketchpad.current
        if (!canvas) return

        saveStatus.value = 'saving'
        saveError.value = ''

        try {
            await State.SaveDrawing(state, {
                image: canvas.toDataURL('image/png'),
                text: text.value,
                alt_text: altText.value
            })
            saveStatus.value = 'saved'
        } catch (err) {
            saveStatus.value = 'error'
            saveError.value = err instanceof Error ?
                err.message :
                'Unable to save the drawing right now.'
            debug('save failed', err)
        }
    }, [])

    const sendDrawing = useCallback(() => {
        const drawingId = state.currentDrawing.value?.id

        if (!drawingId || !state.isAuthed.value) return

        State.GoToSendDrawing(state, drawingId)
    }, [])

    const closeBuyPacks = useCallback(() => {
        State.CloseBuyPackModal(state)
    }, [state])

    return html`<div class="route home">
        <p>
            Draw things, then show people the drawings.
        </p>

        <div class="composer-layout">
            <div class="canvas-column">
                <canvas ref=${sketchpad} id="sketchpad"></canvas>
            </div>

            <form onSubmit=${submitDrawing}>
                <div class="post-text">
                    <label for="text">Text</label>
                    <div class="textarea-with-counter">
                        <textarea
                            id="text"
                            name="text"
                            class="post-text"
                            value=${text.value}
                            onInput=${onTextInput}
                            placeholder="My text message${ELLIPSIS}"
                        ></textarea>
                        <${CharacterCounter.TAG}
                            max=${TEXT_INPUT_MAX}
                            count=${textCount.value}
                            data-counter-for="text"
                        ><//>
                    </div>
                </div>

                <div class="alt-text-field">
                    <label for="alt-text">Alt text</label>
                    <div class="textarea-with-counter">
                        <textarea
                            id="alt-text"
                            name="alt-text"
                            class="alt-text"
                            value=${altText.value}
                            onInput=${onAltTextInput}
                            placeholder=${
                                "Describe your drawing for people who can't " +
                                `see it${ELLIPSIS}`
                            }
                        ></textarea>
                        <${CharacterCounter.TAG}
                            max=${ALT_TEXT_MAX}
                            count=${altTextCount.value}
                            data-counter-for="alt-text"
                        ><//>
                    </div>
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
                    />
                </div>

                <div class="controls">
                    <${Button}
                        type="submit"
                        disabled=${paidActionsDisabled.value}
                        isSpinning=${isSaving}
                    >
                        Save
                    <//>
                    <${Button}
                        type="button"
                        disabled=${!state.isAuthed.value}
                        onClick=${sendDrawing}
                    >
                        Send It
                    <//>
                </div>

                ${saveStatus.value === 'saved' ? html`
                    <p
                        class="drawing-save-status"
                        role="status"
                        aria-label="Drawing save status"
                    >
                        Saved.
                    </p>
                ` : null}

                ${saveStatus.value === 'error' ? html`
                    <p class="drawing-save-error" role="alert">
                        ${saveError.value}
                    </p>
                ` : null}
            </form>
        </div>

        ${state.buyPackModalOpen.value ? html`
            <${BuyPackModal}
                state=${state}
                onClose=${closeBuyPacks}
            />
        ` : null}
    </div>`
}
