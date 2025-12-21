import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import Debug from '@substrate-system/debug'
import './login.css'
import { type State } from '../state.js'

const debug = Debug('example:view:login')

export const AboutRoute:FunctionComponent<{
    state:ReturnType<typeof State>
}> = function AboutRoute ({ state }) {
    debug('login route', state)

    return html`<div class="route login">
        login here
    </div>`
}
