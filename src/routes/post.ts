import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import {
    State,
    type AppState,
    type PublicPost
} from '../state'
import './post.css'

const SHARE_COPY = {
    title: 'A drering for you',
    text: 'Check out this drering:'
} as const

const SHARE_FALLBACK_EVENT = 'drerings:share-fallback'

export const PostRoute:FunctionComponent<{
    state:AppState
}> = function PostRoute ({ state }) {
    const post = useSignal<PublicPost|null>(null)
    const error = useSignal<string>('')
    const isLoading = useSignal<boolean>(true)
    const fallbackUrl = useSignal<string>('')
    const copyStatus = useSignal<string>('')
    const fallbackPanel = useRef<HTMLDivElement|null>(null)
    const routePath = state.route.value.startsWith('/post/') ?
        state.route.value :
        location.pathname
    const postId = postIdFromPath(routePath)
    const canShowShare = !!post.value &&
        state.canShare.value &&
        typeof post.value.id === 'number'

    useEffect(() => {
        if (!postId) {
            isLoading.value = false
            error.value = 'Post not found.'
            setPostMetadata(null)
            return
        }

        isLoading.value = true
        error.value = ''

        State.FetchPublicPost(state, postId).then(publicPost => {
            post.value = publicPost
            setPostMetadata(publicPost)
        }).catch(err => {
            post.value = null
            error.value = err instanceof Error ?
                err.message :
                'Post not found.'
            setPostMetadata(null)
        }).finally(() => {
            isLoading.value = false
        })
    }, [postId])

    useEffect(() => {
        const openFallback = (event:Event):void => {
            if (!state.canShare.value || !post.value) return

            const fallbackEvent = event as CustomEvent<{ url?:unknown }>
            const url = typeof fallbackEvent.detail?.url === 'string' ?
                fallbackEvent.detail.url :
                publicPostUrl(post.value.id)

            fallbackUrl.value = url
            copyStatus.value = ''
        }

        window.addEventListener(SHARE_FALLBACK_EVENT, openFallback)

        return () => {
            window.removeEventListener(SHARE_FALLBACK_EVENT, openFallback)
        }
    }, [])

    useEffect(() => {
        const closeOnEscape = (event:KeyboardEvent):void => {
            if (event.key !== 'Escape') return

            fallbackUrl.value = ''
            copyStatus.value = ''
        }

        document.addEventListener('keydown', closeOnEscape)

        return () => {
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [])

    useEffect(() => {
        const closeOnExternalFocus = (event:FocusEvent):void => {
            if (!fallbackUrl.value) return

            const target = event.target
            const panel = fallbackPanel.current

            if (!panel || !(target instanceof Node)) return
            if (panel.contains(target)) return

            fallbackUrl.value = ''
            copyStatus.value = ''
        }

        document.addEventListener('focusin', closeOnExternalFocus)

        return () => {
            document.removeEventListener('focusin', closeOnExternalFocus)
        }
    }, [])

    const share = useCallback(async () => {
        if (!post.value) return

        await sharePublicPost(post.value)
    }, [])

    const copyLink = useCallback(async () => {
        if (!fallbackUrl.value || !canWriteClipboard()) return

        await navigator.clipboard.writeText(fallbackUrl.value)
        copyStatus.value = 'Copied'
    }, [])

    const downloadImage = useCallback(() => {
        if (!post.value) return

        downloadPublicPostImage(post.value)
    }, [])

    const closeOnFocusOut = useCallback((event:FocusEvent) => {
        const next = event.relatedTarget
        const current = event.currentTarget

        if (!(current instanceof HTMLElement)) return
        if (next instanceof Node && current.contains(next)) return

        fallbackUrl.value = ''
        copyStatus.value = ''
    }, [])

    if (error.value && !isLoading.value) {
        return html`<div class="route post">
            <h2>Post not found</h2>
            <p role="alert">${error.value}</p>
        </div>`
    }

    return html`<div class="route post">
        ${isLoading.value ? html`
            <p role="status">Loading post...</p>
        ` : null}

        ${post.value ? html`
            <article class="public-post">
                <img
                    src=${post.value.image}
                    alt=${post.value.alt_text}
                />
                <p>${post.value.text}</p>
                ${canShowShare ? html`
                    <${Button}
                        type="button"
                        aria-label="Share drawing"
                        onClick=${share}
                    >
                        Share
                    <//>
                    ${fallbackUrl.value ? html`
                        <div
                            class="share-fallback"
                            role="group"
                            aria-label="Share fallback"
                            ref=${fallbackPanel}
                            onBlur=${closeOnFocusOut}
                        >
                            <div class="share-fallback-actions">
                                <${Button}
                                    type="button"
                                    onClick=${copyLink}
                                >
                                    Copy link
                                <//>
                                <${Button}
                                    type="button"
                                    onClick=${downloadImage}
                                >
                                    Download PNG
                                <//>
                            </div>
                            ${canWriteClipboard() ? null : html`
                                <input
                                    class="share-fallback-url"
                                    type="text"
                                    readonly
                                    value=${fallbackUrl.value}
                                />
                            `}
                            ${copyStatus.value ? html`
                                <p class="share-fallback-status" role="status">
                                    ${copyStatus.value}
                                </p>
                            ` : null}
                        </div>
                    ` : null}
                ` : null}
            </article>
        ` : null}
    </div>`
}

function postIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const postIndex = parts.lastIndexOf('post')
    const id = parts[postIndex + 1]

    return id ? decodeURIComponent(id) : null
}

function setPostMetadata (post:PublicPost|null):void {
    if (!post) {
        document.title = 'Post not found - Drerings'
        setMeta('og:title', 'Post not found')
        setMeta('og:image', '')
        return
    }

    const title = post.text.trim() || 'Drerings post'

    document.title = `${title} - Drerings`
    setMeta('og:title', title)
    setMeta('og:image', post.image)
}

function setMeta (property:string, content:string):void {
    let tag = document.head.querySelector<HTMLMetaElement>(
        `meta[property="${property}"]`
    )

    if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute('property', property)
        document.head.append(tag)
    }

    tag.setAttribute('content', content)
}

async function sharePublicPost (post:PublicPost):Promise<void> {
    const url = publicPostUrl(post.id)

    if (!navigator.share || navigator.canShare?.({ url }) !== true) {
        openShareFallback(url)
        return
    }

    try {
        await navigator.share({
            url,
            ...SHARE_COPY
        })
    } catch (err) {
        if (isAbortError(err)) return

        console.error('Unable to share drawing.', err)
    }
}

function publicPostUrl (id:number):string {
    return `${window.location.origin}/post/${id}`
}

function openShareFallback (url:string):void {
    window.dispatchEvent(new CustomEvent(SHARE_FALLBACK_EVENT, {
        detail: { url }
    }))
}

function canWriteClipboard ():boolean {
    return typeof navigator.clipboard?.writeText === 'function'
}

function downloadPublicPostImage (post:PublicPost):void {
    const anchor = document.createElement('a')

    anchor.href = post.image
    anchor.download = `drering-${post.id}.png`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
}

function isAbortError (err:unknown):boolean {
    return err instanceof DOMException && err.name === 'AbortError'
}
