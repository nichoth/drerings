import { h } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { FeedRoute } from '../src/routes/feed'
import { State, type AppState } from '../src/state'

function makePost (overrides:Partial<any> = {}):any {
    return {
        uri: 'at://did:plc:poster/app.bsky.feed.post/abc123',
        cid: 'bafy-post-cid',
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
    }
}

function createFeedState (posts:any[]):AppState {
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
        fireEvent.click(await screen.findByText('Block'))

        await waitFor(() => {
            expect(blockCreateSpy).toHaveBeenCalledTimes(1)
        })

        expect(blockCreateSpy).toHaveBeenCalledWith(
            { repo: 'did:plc:self' },
            expect.objectContaining({
                $type: 'app.bsky.graph.block',
                subject: undefined,
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
        fireEvent.click(await screen.findByText('Report'))

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
