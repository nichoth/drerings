import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import Debug from '@substrate-system/debug'
import { NBSP } from '../constants.js'
import { type State } from '../state.js'
import './colophon.css'

const debug = Debug('example:view:colophon')

export const ColophonRoute:FunctionComponent<{
    state:ReturnType<typeof State>
}> = function ColophonRoute ({ state }) {
    debug('colophon', state)

    return html`<div class="route colophon">
        <h2>About Drerings</h2>

        <p>
            The drawing UI is thanks to an open source library,${NBSP}
            <a href="https://github.com/jakubfiala/atrament">atrament</a>.
        </p>

        <p>
            This uses <a href="https://bsky.app/">Bluesky</a> as a${NBSP}
            <a href="https://nichoth.com/projects/dev-diary-bluesky/">
                backend
            </a>.
        </p>
    </div>`
}
