import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { FeedRoute } from '../src/routes/feed'
import { State, type AppState, type FeedPost } from '../src/state'

function makePost (overrides:Partial<FeedPost> = {}):FeedPost {
    return {
        uri: 'at://did:plc:poster/app.bsky.feed.post/abc123',
        cid: 'bafy-post-cid',
        indexedAt: '2026-02-25T22:00:00.000Z',
        author: {
            did: 'did:plc:poster',
            handle: 'poster.bsky.social',
            displayName: 'Poster',
            avatar: 'https://example.com/avatar.jpg'
        },
        record: {
            text: 'hello world',
            createdAt: '2026-02-25T22:00:00.000Z'
        },
        ...overrides
    } as FeedPost
}

function createFeedState (posts:FeedPost[]):AppState {
    const state = State()
    state.feedReq.value = {
        pending: false,
        data: posts,
        error: null
    }
    return state
}

describe('FeedRoute moderation actions', () => {
    it('renders block and report action buttons for each post', () => {
        const state = createFeedState([makePost(), makePost({
            cid: 'bafy-post-cid-2',
            uri: 'at://did:plc:poster/app.bsky.feed.post/def456'
        })])

        render(h(FeedRoute, { state }))

        expect(screen.getAllByLabelText('Block account'))
            .toHaveLength(2)
        expect(screen.getAllByLabelText('Report post'))
            .toHaveLength(2)
    })

    it('blocks post author when clicking block action', async () => {
        const blockCreateSpy = vi.fn(async () => ({
            uri: 'at://did:plc:self/app.bsky.graph.block/block123',
            cid: 'bafy-block-cid'
        }))
        const state = createFeedState([makePost()])
        state.agent.value = {
            did: 'did:plc:self',
            app: {
                bsky: {
                    graph: {
                        block: {
                            create: blockCreateSpy
                        }
                    }
                }
            }
        } as any
        state.profile.value = {
            did: 'did:plc:self',
            handle: 'self.bsky.social',
            avatar: ''
        }

        render(h(FeedRoute, { state }))
        fireEvent.click(screen.getByLabelText('Block account'))
        fireEvent.click(screen.getByText('Confirm block'))

        await waitFor(() => {
            expect(blockCreateSpy).toHaveBeenCalledTimes(1)
        })

        expect(blockCreateSpy).toHaveBeenCalledWith(
            { repo: 'did:plc:self' },
            expect.objectContaining({
                $type: 'app.bsky.graph.block',
                subject: 'did:plc:poster',
                createdAt: expect.any(String)
            })
        )
    })

    it('reports post when clicking report action', async () => {
        const reportSpy = vi.fn(async () => ({
            success: true,
            headers: {},
            data: {
                id: 1
            }
        }))
        const state = createFeedState([makePost()])
        state.agent.value = {
            createModerationReport: reportSpy
        } as any

        render(h(FeedRoute, { state }))
        fireEvent.click(screen.getByLabelText('Report post'))
        fireEvent.click(screen.getByText('Confirm report'))

        await waitFor(() => {
            expect(reportSpy).toHaveBeenCalledTimes(1)
        })

        expect(reportSpy).toHaveBeenCalledWith({
            reasonType: 'com.atproto.moderation.defs#reasonOther',
            subject: {
                $type: 'com.atproto.repo.strongRef',
                uri: 'at://did:plc:poster/app.bsky.feed.post/abc123',
                cid: 'bafy-post-cid'
            }
        })
    })
})

describe('FeedRoute pagination controls', () => {
    it('renders next and prev buttons with correct disabled state', () => {
        const state = createFeedState([makePost()])
        state.feedCursor.value = 'next-cursor'
        state.feedPageIndex.value = 0

        render(h(FeedRoute, { state }))

        expect((screen.getByRole('button', { name: 'Prev' }) as
            HTMLButtonElement).disabled)
            .toBe(true)
        expect((screen.getByRole('button', { name: 'Next' }) as
            HTMLButtonElement).disabled)
            .toBe(false)
    })

    it('requests next and previous pages from controls', async () => {
        const state = createFeedState([makePost()])
        state.feedCursor.value = 'next-cursor'
        state.feedPageIndex.value = 1

        const fetchFeedSpy = vi.spyOn(State, 'fetchFeed')
            .mockResolvedValue(undefined)

        render(h(FeedRoute, { state }))

        fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        expect(fetchFeedSpy).toHaveBeenCalledWith(state, 'prev')
        expect(fetchFeedSpy).toHaveBeenCalledWith(state, 'next')
    })
})

describe('FeedRoute like counts', () => {
    it('renders constellation like counts for posts', () => {
        const post = makePost({
            uri: 'at://did:plc:poster/app.bsky.feed.post/liked-post'
        })
        const state = createFeedState([post])
        state.feedLikeCounts.value = {
            'at://did:plc:poster/app.bsky.feed.post/liked-post': 12
        }

        render(h(FeedRoute, { state }))

        expect(screen.getByText('12 likes')).toBeTruthy()
    })
})
