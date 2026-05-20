import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect } from 'preact/hooks'
import Debug from '@substrate-system/debug'
import { anchor } from '@substrate-system/anchor'
import { type State } from '../state.js'
import './colophon.css'
import { NBSP } from '../constants.js'

const debug = Debug('example:view:colophon')

export const ColophonRoute:FunctionComponent<{
    state:ReturnType<typeof State>
}> = function ColophonRoute ({ state }) {
    debug('colophon', state)

    useEffect(() => {
        debug('doing the anchor...')
        anchor({ visible: 'touch', base: '/colophon' })
    }, [])

    return html`<div class="route colophon">
        <h2>About Drerings</h2>

        <p>
            This is a <a
                href="https://developer.mozilla.org/en-US/docs/Glossary/SPA"
            >
                single-page application
            </a>. It uses an${NBSP}
            <a href="https://github.com/jakubfiala/atrament">
                open source library called <em>Atrament</em>
            </a> for help with rendering the HTML canvas.
        </p>

        <h2>Drawing</h2>
        <p>
            You can login with an AT protocol account to share the things
            you draw.
        </p>
    </div>`
}
