import { type FunctionComponent } from 'preact'
import { useSignal } from '@preact/signals'
import { html } from 'htm/preact'
import { useCallback } from 'preact/hooks'
import { AppBskyEmbedImages, type AppBskyFeedPost } from '@atproto/api'
import {
    State,
    type AppState,
    type FeedPost,
    type FeedImage,
} from '../state'
import { atUriToBskyUrl, BSKY_WEB_ORIGIN } from '../util'
import Debug from '@substrate-system/debug'
import { ModalWindow } from '@substrate-system/dialog'
import '@substrate-system/dialog/css'
import './feed.css'
import { IconBlock } from '../components/icon-block'
import { IconCaution } from '../components/icon-caution'
import {
    type PostView
} from '@atproto/api/dist/client/types/app/bsky/feed/defs'
const debug = Debug('drerings:view:feed');

(async () => {
    await Promise.race([
        // Load all custom elements
        Promise.allSettled([
            customElements.whenDefined(ModalWindow.TAG),
        ]),
        // Resolve after two seconds
        new Promise(resolve => setTimeout(resolve, 2000))
    ])

    // Remove the class, showing the page content
    document.body.classList.remove('reduce-fouce')
})()

export const FeedRoute:FunctionComponent<{
    state:AppState
}> = function (props) {
    const { state } = props
    const { feedReq, feedCursor, feedPageIndex, feedLikeCounts } = state
    const { pending, data: posts, error } = feedReq.value
    const currentDid = state.profile.value?.did || state.agent.value?.did
    const hasPrevPage = feedPageIndex.value > 0
    const hasNextPage = !!feedCursor.value
    const confirm = useSignal<'block'|'report'|null>(null)
    const pendingBlockOrReport = useSignal<null|string|PostView>(null)

    const blockAuthor = useCallback((ev:MouseEvent) => {
        ev.preventDefault()
        confirm.value = 'block'
        const btn = ev.currentTarget as HTMLButtonElement
        const did = btn.dataset.did!
        debug('block', did)
        pendingBlockOrReport.value = did
    }, [])

    const reportPost = useCallback((post:PostView) => {
        debug('report')
        confirm.value = 'report'
        pendingBlockOrReport.value = post
    }, [])

    const closeConfirmModal = useCallback(() => {
        confirm.value = null
        pendingBlockOrReport.value = null
    }, [])

    const confirmBlock = useCallback(async () => {
        const did = pendingBlockOrReport.value
        const agent = state.agent.value
        const repoDid = state.profile.value?.did || agent?.did

        if (typeof did !== 'string' || !agent || !repoDid) {
            return closeConfirmModal()
        }

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
        } finally {
            closeConfirmModal()
        }
    }, [
        state.agent.value,
        state.profile.value?.did,
        pendingBlockOrReport.value
    ])

    const confirmReport = useCallback(async () => {
        const pendingTarget = pendingBlockOrReport.value
        const post = (typeof pendingTarget === 'string' ?
            null :
            pendingTarget)
        const agent = state.agent.value
        if (!agent || !post) return closeConfirmModal()

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
        } finally {
            closeConfirmModal()
        }
    }, [state.agent.value, pendingBlockOrReport.value])

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
                const likeCount = typeof feedLikeCounts.value[post.uri] ===
                    'number' ?
                    feedLikeCounts.value[post.uri] :
                    (post.likeCount || 0)
                const isCurrentUsersPost = !!currentDid &&
                    post.author.did === currentDid

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

                            <span class="feed-item-like-count">
                                ${formatLikeCount(likeCount)}
                            </span>
                        </div>

                        ${isCurrentUsersPost ? null : html`<div class="feed-item-actions">
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
                        </div>`}
                    </div>
                </article>`
            })}
        </div>

        ${(hasPrevPage || hasNextPage) ? html`<div class="feed-pagination">
            <button
                class="btn"
                onClick=${() => {
                    State.fetchFeed(state, 'prev')
                }}
                disabled=${pending || !hasPrevPage}
            >
                Prev
            </button>
            <button
                class="btn"
                onClick=${() => {
                    State.fetchFeed(state, 'next')
                }}
                disabled=${pending || !hasNextPage}
            >
                Next
            </button>
        </div>` : null}
    </div>

    <${ModalWindow.TAG}
        onClose=${closeConfirmModal}
        active=${confirm.value === 'block'}
    >
        <div class="feed-confirm-body">
            <p>Block this account?</p>
            <div class="feed-confirm-actions">
                <button
                    type="button"
                    class="feed-confirm-btn"
                    onClick=${closeConfirmModal}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="feed-confirm-btn"
                    onClick=${confirmBlock}
                >
                    Confirm block
                </button>
            </div>
        </div>
    </${ModalWindow.TAG}>

    <${ModalWindow.TAG}
        onClose=${closeConfirmModal}
        active=${confirm.value === 'report'}
    >
        <div class="feed-confirm-body">
            <p>Report this post?</p>
            <div class="feed-confirm-actions">
                <button
                    type="button"
                    class="feed-confirm-btn"
                    onClick=${closeConfirmModal}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="feed-confirm-btn"
                    onClick=${confirmReport}
                >
                    Confirm report
                </button>
            </div>
        </div>
    </${ModalWindow.TAG}>
    `
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

function formatLikeCount (count:number):string {
    return `${count} like${count === 1 ? '' : 's'}`
}
