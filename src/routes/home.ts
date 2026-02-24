import { html } from 'htm/preact'
import { useRef, useEffect, useCallback } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import { useComputed, useSignal } from '@preact/signals'
import './home.css'
import { type AppState } from '../state'
import { Button, LinkBtn } from '../components/button'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:view')

export const HomeRoute:FunctionComponent<{
    state:AppState
}> = function HomeRoute ({ state }) {
    const sketchpad = useRef<HTMLCanvasElement>(null)
    const isCanvasDirty = useSignal<boolean>(false)

    useEffect(() => {
        debug('sketchpad.current', sketchpad.current)
        if (!sketchpad.current) return
        const canvas = sketchpad.current

        const atrament = new Atrament(sketchpad.current, {
            width: canvas.offsetWidth,
            height: canvas.offsetHeight,
            ignoreModifiers: true,
            fill,
        })
        atrament.smoothing = 0.7

        atrament.addEventListener('dirty', () => {
            isCanvasDirty.value = true
        })

        atrament.addEventListener('clean', () => {
            isCanvasDirty.value = false
        })
    }, [sketchpad.current])

    const disable = useComputed<boolean>(() => {
        return state.isAuthed.value && !isCanvasDirty.value
    })

    const login = useCallback((ev:SubmitEvent) => {
        ev.preventDefault()
        debug('logging in...')
    }, [])

    const submitDrering = useCallback((ev:SubmitEvent) => {
        ev.preventDefault()
        debug('submit my drawing...', ev.target)
    }, [])

    return html`<div class="route home">
        <p>
            Draw things, then show people the drawings.
        </p>

        <canvas ref=${sketchpad} id="sketchpad"></canvas>

        <form onSubmit=${state.isAuthed.value ? submitDrering : login}>
            <div class="controls">
                ${state.isAuthed.value ?
                    html`<${Button}
                        type="submit"
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
        </form>
    </div>`
}
