import { test } from '@substrate-system/tapzero'
import {
    countGraphemes,
    TEXT_INPUT_MAX
} from '../src/post-text'
import { paramsFromQueryLike } from '../src/util'
import { State } from '../src/state'

test('paramsFromQueryLike strips prefix characters', async t => {
    const fromQuery = paramsFromQueryLike('?state=abc&code=123')
    const fromHash = paramsFromQueryLike('#state=xyz&error=bad')

    t.equal(fromQuery.get('state'), 'abc')
    t.equal(fromQuery.get('code'), '123')
    t.equal(fromHash.get('state'), 'xyz')
    t.equal(fromHash.get('error'), 'bad')
})

test('countGraphemes handles plain text and emoji', async t => {
    t.equal(countGraphemes('hello'), 5)
    t.equal(countGraphemes('👩‍💻'), 1)
    t.equal(TEXT_INPUT_MAX, 300)
})

test('State starts with anonymous auth state', async t => {
    const state = State()

    t.equal(state.auth.value.authenticated, false)
    t.equal(state.auth.value.registered, false)
    t.equal(state.profile.value, null)
})

test('all done', () => {
    // @ts-expect-error tests
    if (window) window.testsFinished = true
})
