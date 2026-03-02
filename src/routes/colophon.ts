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
            We are using <a
                href="https://nichoth.com/projects/dev-diary-bluesky/"
            >Bluesky as a backend</a>.
        </p>

        <p>
            Any drawing you submit here will be posted to Bluesky under the
            username that you signed in with. I am using Bluesky as the backend
            because that way I get a social graph and moderation for free.
            The login screen redirects to Bluesky for OAuth, but
            you should think of it as an account/profile
            for <em>this app</em>.
        </p>

        <h2>The Feed</h2>
        <p>
            The feed is just a chronological list of all posts that contain
            the tag "drerings." It doesn't use you social graph in any way.
            The better option would be to use a <a href="https://docs.bsky.app/docs/tutorials/custom-feeds">
                custom feed</a> that filters for the tag.
        </p>

        <h2>Posts</h2>
        <p>
            In the post screen, you will notice there is a character limit
            of <code>274</code>. That's because every post has a link back
            to this website appended to it, so we subtract that length from
            the 300 total character count that Bluesky gives you.
        </p>
    </div>`
}
