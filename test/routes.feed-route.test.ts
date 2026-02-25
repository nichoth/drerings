import { beforeEach, describe, expect, it, vi } from 'vitest'
import { State } from '../src/state'

vi.mock('../src/routes/home.js', () => ({ HomeRoute: () => null }))
vi.mock('../src/routes/contact.js', () => ({ ContactRoute: () => null }))
vi.mock('../src/routes/colophon.js', () => ({ ColophonRoute: () => null }))
vi.mock('../src/routes/login.js', () => ({ LoginRoute: () => null }))
vi.mock('../src/routes/whoami.js', () => ({ WhoamiRoute: () => null }))
vi.mock('../src/routes/feed.js', () => ({ FeedRoute: () => null }))

async function createRouter (state:ReturnType<typeof State>) {
    const { default: Router } = await import('../src/routes/index')
    return Router(state)
}

describe('/feed route', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('fetches once when request is idle', async () => {
        const state = State()
        const fetchFeedSpy = vi.spyOn(State, 'fetchFeed')
            .mockResolvedValue(undefined)
        const router = await createRouter(state)
        const match = router.match('/feed')

        expect(match?.action).toBeTypeOf('function')
        if (!match?.action) throw new Error('missing /feed route action')
        match.action(match, '/feed')

        expect(fetchFeedSpy).toHaveBeenCalledTimes(1)
        expect(fetchFeedSpy).toHaveBeenCalledWith(state)
    })

    it('does not auto-retry after a failed request', async () => {
        const state = State()
        state.feedReq.value = {
            pending: false,
            data: null,
            error: new Error('Failed to fetch')
        }

        const fetchFeedSpy = vi.spyOn(State, 'fetchFeed')
            .mockResolvedValue(undefined)
        const router = await createRouter(state)
        const match = router.match('/feed')

        expect(match?.action).toBeTypeOf('function')
        if (!match?.action) throw new Error('missing /feed route action')
        match.action(match, '/feed')

        expect(fetchFeedSpy).not.toHaveBeenCalled()
    })
})
