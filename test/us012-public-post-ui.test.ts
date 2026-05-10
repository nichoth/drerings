import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/preact'
import { State, type AppState } from '../src/state'
import Router from '../src/routes/index'
import { PostRoute } from '../src/routes/post'

interface PublicPost {
    id:number;
    image:string;
    text:string;
    alt_text:string;
    published_at:string;
}

interface PublicPostState {
    FetchPublicPost:(state:AppState, postId:string)=>Promise<PublicPost>;
}

describe('US-012 public post UI', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        document.title = ''
        document.head
            .querySelectorAll('meta[property^="og:"]')
            .forEach(meta => meta.remove())
    })

    it('routes /post/:id to the public post route', () => {
        const state = State()
        const router = Router(state)
        const match = router.match('/post/42')

        expect(match?.params).toEqual({ id: '42' })
        expect(match?.action?.(match, '/post/42')).toBe(PostRoute)
    })

    it('fetches and renders a public post with share metadata', async () => {
        const fetcher = vi.fn(async (url:string) => {
            if (url === '/api/posts/42') {
                return jsonResponse(publicPost())
            }

            return jsonResponse({ error: 'Post not found.' }, false, 404)
        })

        vi.stubGlobal('fetch', fetcher)
        history.pushState(null, '', '/post/42')

        const fetchPublicPost = (State as unknown as PublicPostState)
            .FetchPublicPost

        expect(fetchPublicPost).toEqual(expect.any(Function))
        expect(await fetchPublicPost(State(), '42')).toEqual(publicPost())

        render(h(PostRoute, { state: State() }))

        const image = await screen.findByRole('img', {
            name: 'A hand drawn red circle'
        })

        expect(image.getAttribute('src')).toBe(publicPost().image)
        expect(screen.getByText('A red circle')).toBeTruthy()

        await waitFor(() => {
            expect(document.title).toBe('A red circle - Drerings')
        })
        expect(document.querySelector('meta[property="og:title"]')
            ?.getAttribute('content')).toBe('A red circle')
        expect(document.querySelector('meta[property="og:image"]')
            ?.getAttribute('content')).toBe(publicPost().image)
    })
})

function publicPost ():PublicPost {
    return {
        id: 42,
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        published_at: '2026-05-10T12:20:00.000Z'
    }
}

function jsonResponse (
    body:unknown,
    ok = true,
    status = 200
):Response {
    return {
        ok,
        status,
        json: async () => body
    } as Response
}
