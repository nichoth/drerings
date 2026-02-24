import { type FunctionComponent } from 'preact'
import { html } from 'htm/preact'
import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { type AppState, INVISIBLE_POST_TAG } from '../state'
import { atUriToBskyUrl, BSKY_WEB_ORIGIN } from '../util'
import Debug from '@substrate-system/debug'
import './feed.css'
const debug = Debug('drerings:view:feed')

const SEARCH_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts'

interface FeedImage {
    thumb:string;
    fullsize:string;
    alt:string;
}

interface FeedPost {
    uri:string;
    cid:string;
    author:{
        did:string;
        handle:string;
        displayName?:string;
        avatar?:string;
    };
    record:{
        text:string;
        createdAt:string;
    };
    embed?:{
        $type:string;
        images?:Array<{
            thumb:string;
            fullsize:string;
            alt:string;
        }>;
    };
    likeCount?:number;
    repostCount?:number;
    replyCount?:number;
}

export const FeedRoute:FunctionComponent<{ state:AppState }> = function (props) {
    const { state } = props
    debug('the feed route', state)

    const posts = useSignal<FeedPost[]>([])
    const loading = useSignal<boolean>(true)
    const error = useSignal<string|null>(null)
    const cursor = useSignal<string|null>(null)
    const loadingMore = useSignal<boolean>(false)

    useEffect(() => {
        fetchPosts()
    }, [])

    async function fetchPosts (loadMore = false) {
        if (loadMore) {
            loadingMore.value = true
        } else {
            loading.value = true
        }
        error.value = null

        try {
            const url = new URL(SEARCH_ENDPOINT)
            url.searchParams.set('q', '#' + INVISIBLE_POST_TAG)
            url.searchParams.set('sort', 'latest')
            url.searchParams.set('limit', '30')

            if (loadMore && cursor.value) {
                url.searchParams.set('cursor', cursor.value)
            }

            const res = await fetch(url.toString())
            if (!res.ok) {
                throw new Error(`Search failed: ${res.status}`)
            }

            const data = await res.json()
            debug('search results', data)

            cursor.value = data.cursor || null

            if (loadMore) {
                posts.value = [...posts.value, ...data.posts]
            } else {
                posts.value = data.posts || []
            }
        } catch (err) {
            const msg = err instanceof Error ?
                err.message :
                'Failed to load feed'
            error.value = msg
            debug('feed fetch error', err)
        } finally {
            loading.value = false
            loadingMore.value = false
        }
    }

    function getImages (post:FeedPost):FeedImage[] {
        if (!post.embed) return []

        // Direct images embed
        if (post.embed.$type === 'app.bsky.embed.images#view' &&
            post.embed.images) {
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

    if (loading.value) {
        return html`<div class="route feed">
            <p class="feed-loading">Loading drerings...</p>
        </div>`
    }

    if (error.value) {
        return html`<div class="route feed">
            <p class="feed-error">${error.value}</p>
        </div>`
    }

    if (!posts.value.length) {
        return html`<div class="route feed">
            <p>No drerings found yet.</p>
        </div>`
    }

    return html`<div class="route feed">
        <div class="feed-grid">
            ${posts.value.map(post => {
                const images = getImages(post)
                const bskyUrl = atUriToBskyUrl(post.uri)
                const authorUrl = `${BSKY_WEB_ORIGIN}/profile/${post.author.handle}`

                return html`<article class="feed-item" key=${post.cid}>
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
                                alt="${images[0].alt || 'Drering'}"
                                loading="lazy"
                            />
                        </a>
                    ` : null}

                    <div class="feed-item-body">
                        ${post.record.text ? html`<p class="feed-item-text">
                            ${post.record.text}
                        </p>` : null}

                        <div class="feed-item-meta">
                            <a
                                class="feed-item-author"
                                href="${authorUrl}"
                                target="_blank"
                                rel="noreferrer"
                            >
                                ${post.author.avatar ? html`<img
                                    class="feed-item-avatar"
                                    src="${post.author.avatar}"
                                    alt=""
                                />` : null}
                                <span>${post.author.displayName
                                    || post.author.handle}</span>
                            </a>

                            <time class="feed-item-date">
                                ${formatDate(post.record.createdAt)}
                            </time>
                        </div>
                    </div>
                </article>`
            })}
        </div>

        ${cursor.value ? html`<div class="feed-load-more">
            <button
                class="btn"
                onClick=${() => fetchPosts(true)}
                disabled=${loadingMore.value}
            >
                ${loadingMore.value ? 'Loading...' : 'Load more'}
            </button>
        </div>` : null}
    </div>`
}
