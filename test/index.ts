import { test } from '@substrate-system/tapzero'
import {
    paramsFromQueryLike,
    oauthParamsFromUrlLike,
    oauthRedirectUri,
    oauthClientId,
    isLoopbackHost,
    hasOAuthCallback,
    readOAuthParamsFromLocation,
    atUriToBskyUrl
} from '../src/util'
import { did, config } from '../src/config'

test('paramsFromQueryLike strips prefix characters', async t => {
    const fromQuery = paramsFromQueryLike('?state=abc&code=123')
    const fromHash = paramsFromQueryLike('#state=xyz&error=bad')

    t.equal(fromQuery.get('state'), 'abc')
    t.equal(fromQuery.get('code'), '123')
    t.equal(fromHash.get('state'), 'xyz')
    t.equal(fromHash.get('error'), 'bad')
})

test('oauthParamsFromUrlLike merges search and hash params', async t => {
    const params = oauthParamsFromUrlLike(
        'https://example.com/login?state=from-search#' +
            'code=abc&iss=https%3A%2F%2Fbsky.social'
    )

    t.equal(params.get('state'), 'from-search')
    t.equal(params.get('code'), 'abc')
    t.equal(params.get('iss'), 'https://bsky.social')
})

test('oauthParamsFromUrlLike keeps search value when keys overlap', async t => {
    const params = oauthParamsFromUrlLike(
        'https://example.com/login?state=search-value#state=hash-value&code=abc'
    )

    t.equal(params.get('state'), 'search-value')
    t.equal(params.get('code'), 'abc')
})

test('hasOAuthCallback requires state and code/error', async t => {
    t.equal(hasOAuthCallback('state=abc&code=123'), true)
    t.equal(hasOAuthCallback('state=abc&error=access_denied'), true)
    t.equal(hasOAuthCallback('code=123'), false)
    t.equal(hasOAuthCallback('state=abc'), false)
    t.equal(hasOAuthCallback('state=abc&iss=https://bsky.social'), false)
})

test('oauthRedirectUri normalizes localhost callback origin', async t => {
    const redirectUri = new URL(oauthRedirectUri())

    t.equal(redirectUri.pathname, '/login')

    if (location.hostname === 'localhost') {
        t.equal(redirectUri.hostname, '127.0.0.1')
    } else {
        t.equal(redirectUri.hostname, location.hostname)
    }
})

test('oauthClientId includes redirect_uri and scope', async t => {
    const clientId = new URL(oauthClientId())
    const redirectUri = clientId.searchParams.get('redirect_uri')

    t.equal(
        clientId.searchParams.get('scope'),
        'atproto repo:app.bsky.feed.post?action=create ' +
            'repo:app.bsky.actor.profile?action=create&action=update ' +
            'blob:*/* ' +
            'rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview'
    )
    t.ok(!!redirectUri, 'client id includes redirect_uri')

    if (isLoopbackHost(location.hostname)) {
        t.equal(clientId.origin, 'http://localhost')
    } else {
        t.equal(clientId.pathname, '/api/auth/oauth/client-metadata')
    }
})

test('readOAuthParamsFromLocation utility parses explicit href', async t => {
    const params = readOAuthParamsFromLocation(
        'https://example.com/login?state=abc#code=123&error=denied'
    )

    t.equal(params.get('state'), 'abc')
    t.equal(params.get('code'), '123')
    t.equal(params.get('error'), 'denied')
})

test('did config helper returns expected document shape', async t => {
    const doc = did({
        did: 'did:web:example.com',
        host: 'example.com',
        publicKey: 'zExamplePublicKey'
    })

    t.equal(doc.id, 'did:web:example.com')
    t.equal(doc.service?.[0].type, 'BskyFeedGenerator')
    t.equal(doc.service?.[0].serviceEndpoint, 'https://example.com')
    t.equal(doc.verificationMethod?.[0].controller, 'did:web:example.com')
    t.equal(config.recordName, 'drering')
})

test('atUriToBskyUrl converts profile and post URIs', async t => {
    t.equal(
        atUriToBskyUrl('at://alice.bsky.social'),
        'https://bsky.app/profile/alice.bsky.social'
    )
    t.equal(
        atUriToBskyUrl('at://did:plc:alice/app.bsky.feed.post/3lf4xabcdef'),
        'https://bsky.app/profile/did:plc:alice/post/3lf4xabcdef'
    )
})

test('all done', () => {
    // @ts-expect-error tests
    if (window) window.testsFinished = true
})
