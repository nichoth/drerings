import { html } from 'htm/preact'
import { useRef, useEffect } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Atrament from '@substrate-system/atrament'
import fill from '@substrate-system/atrament/fill?worker'
import './home.css'
import Debug from '@substrate-system/debug'
const debug = Debug('drerings:view')

export const HomeRoute:FunctionComponent = function HomeRoute () {
    const sketchpad = useRef<HTMLCanvasElement>(null)
    debug('the sketchpad...', sketchpad.current)

    useEffect(() => {
        debug('sketchpad.current', sketchpad.current)
        if (!sketchpad.current) return
        const canvas = sketchpad.current

        // instantiate Atrament
        const atrament = new Atrament(sketchpad.current, {
            width: canvas.offsetWidth,
            height: canvas.offsetHeight,
            ignoreModifiers: true,
            fill,
        })
        atrament.smoothing = 0.7
    }, [sketchpad.current])

    return html`<div class="route home">
        <p>
            Draw things, and show people your drawings.
        </p>

        <canvas ref=${sketchpad} id="sketchpad"></canvas>
    </div>`
}
