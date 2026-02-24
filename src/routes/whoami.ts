import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import Debug from '@substrate-system/debug'
import { type AppState } from '../state.js'
import { BSKY_WEB_ORIGIN } from '../util.js'
import './whoami.css'

const debug = Debug('drerings:view:whoami')

interface FullProfile {
    did:string;
    handle:string;
    displayName:string;
    avatar:string;
    description:string;
    followersCount:number;
    followsCount:number;
    postsCount:number;
    banner:string;
}

export const WhoamiRoute:FunctionComponent<{
    state:AppState
}> = function WhoamiRoute ({ state }) {
    debug('whoami', state)

    const profile = useSignal<FullProfile|null>(null)
    const loading = useSignal<boolean>(true)
    const error = useSignal<string|null>(null)

    useEffect(() => {
        async function fetchProfile () {
            const agent = state.agent.value
            if (!agent || !state.profile.value?.did) {
                loading.value = false
                return
            }

            try {
                const res = await agent.getProfile({
                    actor: state.profile.value.did
                })
                profile.value = {
                    did: res.data.did,
                    handle: res.data.handle,
                    displayName: res.data.displayName || '',
                    avatar: res.data.avatar || '',
                    description: res.data.description || '',
                    followersCount: res.data.followersCount ?? 0,
                    followsCount: res.data.followsCount ?? 0,
                    postsCount: res.data.postsCount ?? 0,
                    banner: res.data.banner || '',
                }
            } catch (err) {
                debug('fetch full profile error', err)
                error.value = 'Could not load profile.'
            } finally {
                loading.value = false
            }
        }

        fetchProfile()
    }, [state.agent.value, state.profile.value?.did])

    if (!state.isAuthed.value) {
        return html`<div class="route whoami">
            <p>You are not logged in. <a href="/login">Log in</a> to see
            your profile.</p>
        </div>`
    }

    if (loading.value) {
        return html`<div class="route whoami">
            <p>Loading profile…</p>
        </div>`
    }

    if (error.value) {
        return html`<div class="route whoami">
            <p class="error-banner">${error.value}</p>
        </div>`
    }

    const p = profile.value
    if (!p) return null

    const bskyUrl = `${BSKY_WEB_ORIGIN}/profile/${encodeURIComponent(p.handle)}`

    return html`<div class="route whoami">
        ${p.banner && html`<div class="whoami-banner">
            <img src="${p.banner}" alt="" />
        </div>`}

        <div class="whoami-card">
            ${p.avatar && html`<img
                class="whoami-avatar"
                src="${p.avatar}"
                alt="${p.handle}"
            />`}

            <div class="whoami-info">
                ${p.displayName && html`<h2 class="whoami-name">
                    ${p.displayName}
                </h2>`}

                <p class="whoami-handle">
                    <a href="${bskyUrl}"
                        target="_blank"
                        rel="noreferrer"
                    >@${p.handle}</a>
                </p>

                ${p.description && html`<p class="whoami-bio">
                    ${p.description}
                </p>`}
            </div>
        </div>

        <dl class="whoami-stats">
            <div class="stat">
                <dt>Posts</dt>
                <dd>${p.postsCount}</dd>
            </div>
            <div class="stat">
                <dt>Following</dt>
                <dd>${p.followsCount}</dd>
            </div>
            <div class="stat">
                <dt>Followers</dt>
                <dd>${p.followersCount}</dd>
            </div>
        </dl>

        <p class="whoami-did">
            <small>${p.did}</small>
        </p>
    </div>`
}
