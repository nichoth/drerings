import { html } from 'htm/preact'
import { useRef, useEffect } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import { useSignal } from '@preact/signals'
import './home.css'
import { Button } from '../components/button'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:view')

export const HomeRoute:FunctionComponent = function HomeRoute () {
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

    return html`<div class="route home">
        <p>
            Draw things, and show people your drawings.
        </p>

        <canvas ref=${sketchpad} id="sketchpad"></canvas>

        <form>
            <div class="controls">
                <${Button}
                    type="submit"
                    disabled=${!isCanvasDirty.value}
                >
                    Post It
                <//>
            </div>
        </form>
    </div>`
}
