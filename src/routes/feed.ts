import { type FunctionComponent } from 'preact'
import { html, useCallback } from 'htm/preact'
import {
    AppBskyEmbedImages,
    type AppBskyFeedPost
} from '@atproto/api'
import {
    State,
    type AppState,
    type FeedPost,
    type FeedImage,
} from '../state'
import { atUriToBskyUrl, BSKY_WEB_ORIGIN } from '../util'
import Debug from '@substrate-system/debug'
import './feed.css'
import { IconBlock } from '../components/icon-block'
import { IconCaution } from '../components/icon-caution'
const debug = Debug('drerings:view:feed')

export const FeedRoute:FunctionComponent<{
    state:AppState
}> = function (props) {
    const { state } = props
    debug('the feed route', state)

    const { feedReq, feedCursor } = state
    const { pending, data: posts, error } = feedReq.value

    const blockAuthor = useCallback(async (ev:MouseEvent) => {
        ev.preventDefault()
        const btn = ev.target as HTMLButtonElement
        const did = btn.dataset.did!
        const agent = state.agent.value
        const repoDid = state.profile.value?.did || agent?.did

        if (!agent || !repoDid || did) return

        try {
            await agent.app.bsky.graph.block.create(
                { repo: repoDid },
                {
                    $type: 'app.bsky.graph.block',
                    subject: did,
                    createdAt: new Date().toISOString()
                }
            )
        } catch (err) {
            debug('failed blocking account', err)
        }
    }, [])

    // async function blockAuthor (post:FeedPost):Promise<void> {
    //     const agent = state.agent.value
    //     const repoDid = state.profile.value?.did || agent?.did

    //     if (!agent || !repoDid || !post.author.did) return

    //     try {
    //         await agent.app.bsky.graph.block.create(
    //             { repo: repoDid },
    //             {
    //                 $type: 'app.bsky.graph.block',
    //                 subject: post.author.did,
    //                 createdAt: new Date().toISOString()
    //             }
    //         )
    //     } catch (err) {
    //         debug('failed blocking account', err)
    //     }
    // }

    async function reportPost (post:FeedPost):Promise<void> {
        const agent = state.agent.value
        if (!agent) return

        try {
            await agent.createModerationReport({
                reasonType: 'com.atproto.moderation.defs#reasonOther',
                subject: {
                    $type: 'com.atproto.repo.strongRef',
                    uri: post.uri,
                    cid: post.cid
                }
            })
        } catch (err) {
            debug('failed reporting post', err)
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
                const authorUrl = `${BSKY_WEB_ORIGIN}/profile/` +
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
                                ${formatDate(record.createdAt)}
                            </time>
                        </div>

                        <div class="feed-item-actions">
                            <button
                                id="block"
                                type="button"
                                class="feed-item-action"
                                aria-label="Block account"
                                data-did="${post.author.did}"
                                title="Block account"
                                onClick=${blockAuthor}
                            >
                                <span>Block</span>
                                <span><${IconBlock} /></span>
                            </button>

                            <button
                                id="report"
                                type="button"
                                class="feed-item-action"
                                aria-label="Report post"
                                title="Report post"
                                onClick=${async () => {
                                    await reportPost(post)
                                }}
                            >
                                <span>Report</span>
                                <span><${IconCaution} /></span>
                            </button>
                        </div>
                    </div>
                </article>`
            })}
        </div>

        ${feedCursor.value ? html`<div class="feed-load-more">
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
