import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import Debug from '@substrate-system/debug'
import { type State } from '../state.js'
import './about.css'

const debug = Debug('example:view:about')

export const ContactRoute:FunctionComponent<{
    state:ReturnType<typeof State>
}> = function ContactRoute () {
    debug('about')
    return html`<div class="route about">
        <h2>About Drerings</h2>

        <p>
            <code>Drerings</code> is a tool for drawing things, and sharing
            the drawings.
        </p>
    </div>`
}
