import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { Button } from '../components/button'
import {
    State,
    type AppState,
    type PublicPost
} from '../state'
import './post.css'

export const PostRoute:FunctionComponent<{
    state:AppState
}> = function PostRoute ({ state }) {
    const post = useSignal<PublicPost|null>(null)
    const error = useSignal<string>('')
    const isLoading = useSignal<boolean>(true)
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

    const share = useCallback(() => {}, [])

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
