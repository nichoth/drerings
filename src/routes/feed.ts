import { type FunctionComponent } from 'preact'
import { html } from 'htm/preact'
import {
    AppBskyEmbedImages,
    type AppBskyFeedPost
} from '@atproto/api'
import {
    State,
    type AppState,
    type FeedPost,
    type FeedImage,
    SEARCH_POSTS_SCOPE,
} from '../state'
import { atUriToBskyUrl, BSKY_WEB_ORIGIN } from '../util'
import Debug from '@substrate-system/debug'
import './feed.css'
const debug = Debug('drerings:view:feed')

export const FeedRoute:FunctionComponent<{
    state:AppState
}> = function (props) {
    const { state } = props
    debug('the feed route', state)

    const { feedReq, feedCursor } = state
    const { pending, data: posts, error } = feedReq.value
    const isMissingFeedScope = Boolean(
        error &&
        error.message.includes('Missing required scope') &&
        error.message.includes(SEARCH_POSTS_SCOPE)
    )

    function formatDate (iso:string):string {
        try {
            const d = new Date(iso)
            return d.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            })
        } catch {
            return ''
        }
    }

    if (pending && !posts) {
        return html`<div class="route feed">
            <p class="feed-loading">
                Loading drerings...
            </p>
        </div>`
    }

    if (error) {
        return html`<div class="route feed">
            <p class="feed-error">
                ${error.message}
            </p>
            ${isMissingFeedScope ? html`<div class="feed-error-actions">
                <p class="feed-error-help">
                    Re-authorize once to grant feed-read scope.
                </p>
                <button
                    class="btn"
                    onClick=${() => {
                        void State.requestFeedScope(state).catch(err => {
                            debug('scope upgrade request failed', err)
                        })
                    }}
                >
                    Grant Required Scope
                </button>
            </div>` : null}
        </div>`
    }

    if (!posts || !posts.length) {
        return html`<div class="route feed">
            <p>No drerings found yet.</p>
        </div>`
    }

    return html`<div class="route feed">
        <div class="feed-grid">
            ${posts.map(post => {
                const images = getImages(post)
                const bskyUrl = atUriToBskyUrl(post.uri)
                const authorUrl =
                    `${BSKY_WEB_ORIGIN}/profile/` +
                    post.author.handle

                const record = post.record as AppBskyFeedPost.Main

            return html`<article
                    class="feed-item"
                    key=${post.cid}
                >
                    ${images.length > 0 ? html`
                        <a
                            href="${bskyUrl}"
                            target="_blank"
                            rel="noreferrer"
                            class="feed-item-image-link"
                        >
                            <img
                                class="feed-item-image"
                                src="${images[0].thumb}"
                                alt="${images[0].alt ||
                                    'Drering'}"
                                loading="lazy"
                            />
                        </a>
                    ` : null}

                    <div class="feed-item-body">
                        ${record.text ?
                            html`<p
                                class="feed-item-text"
                            >
                                ${record.text}
                            </p>` :
                            null}

                        <div class="feed-item-meta">
                            <a
                                class="feed-item-author"
                                href="${authorUrl}"
                                target="_blank"
                                rel="noreferrer"
                            >
                                ${post.author.avatar ?
                                    html`<img
                                        class="feed-item-avatar"
                                        src="${post
                                            .author
                                            .avatar}"
                                        alt=""
                                    />` :
                                    null}
                                <span>${
                                    post.author
                                        .displayName ||
                                    post.author.handle
                                }</span>
                            </a>

                            <time class="feed-item-date">
                                ${formatDate(
                                    record.createdAt
                                )}
                            </time>
                        </div>
                    </div>
                </article>`
            })}
        </div>

        ${feedCursor.value ? html`<div
            class="feed-load-more"
        >
            <button
                class="btn"
                onClick=${() => {
                    State.fetchFeed(state, true)
                }}
                disabled=${pending}
            >
                ${pending ? 'Loading...' : 'Load more'}
            </button>
        </div>` : null}
    </div>`
}

function getImages (post:FeedPost):FeedImage[] {
    if (!post.embed) return []
    if (AppBskyEmbedImages.isView(post.embed)) {
        return post.embed.images
    }
    return []
}
