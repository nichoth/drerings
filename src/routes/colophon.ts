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
            This is a <a href="https://developer.mozilla.org/en-US/docs/Glossary/SPA">
                single-page application
            </a>, made with an${NBSP}
            <a href="https://github.com/jakubfiala/atrament">
                open source library, Atrament.
            </a> It uses <a href="https://nichoth.com/projects/dev-diary-bluesky/">
                Bluesky as a backend</a>.

        </p>

        <p>
            Any drawing you submit will be posted to Bluesky under the
            username that you signed in with.
        </p>
    </div>`
}
