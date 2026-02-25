import { describe, expect, it } from 'vitest'
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

describe('oauth utils', () => {
    it('strips query/hash prefix when parsing callback params', () => {
        const fromQuery = paramsFromQueryLike('?state=abc&code=123')
        const fromHash = paramsFromQueryLike('#state=xyz&error=bad')

        expect(fromQuery.get('state')).toBe('abc')
        expect(fromQuery.get('code')).toBe('123')
        expect(fromHash.get('state')).toBe('xyz')
        expect(fromHash.get('error')).toBe('bad')
    })

    it('merges search and hash params while preserving search precedence', () => {
        const merged = oauthParamsFromUrlLike(
            'https://example.com/login?state=from-search#code=abc&iss=https%3A%2F%2Fbsky.social'
        )
        expect(merged.get('state')).toBe('from-search')
        expect(merged.get('code')).toBe('abc')
        expect(merged.get('iss')).toBe('https://bsky.social')

        const overlap = oauthParamsFromUrlLike(
            'https://example.com/login?state=search-value#state=hash-value&code=abc'
        )
        expect(overlap.get('state')).toBe('search-value')
        expect(overlap.get('code')).toBe('abc')
    })

    it('detects oauth callbacks only for state + code/error', () => {
        expect(hasOAuthCallback('state=abc&code=123')).toBe(true)
        expect(hasOAuthCallback('state=abc&error=access_denied')).toBe(true)
        expect(hasOAuthCallback('code=123')).toBe(false)
        expect(hasOAuthCallback('state=abc')).toBe(false)
        expect(hasOAuthCallback('state=abc&iss=https://bsky.social')).toBe(false)
    })

    it('normalizes localhost redirect URI for local oauth dev', () => {
        const redirectUri = new URL(oauthRedirectUri())
        expect(redirectUri.pathname).toBe('/login')

        if (location.hostname === 'localhost') {
            expect(redirectUri.hostname).toBe('127.0.0.1')
        } else {
            expect(redirectUri.hostname).toBe(location.hostname)
        }
    })

    it('builds client id with expected redirect + scope params', () => {
        const clientId = new URL(oauthClientId())
        expect(clientId.searchParams.get('scope')).toBe(
            'atproto repo:app.bsky.feed.post?action=create ' +
            'repo:app.bsky.actor.profile?action=create&action=update ' +
            'blob:*/* ' +
            'rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview'
        )
        expect(clientId.searchParams.get('redirect_uri')).toBeTruthy()

        if (isLoopbackHost(location.hostname)) {
            expect(clientId.origin).toBe('http://localhost')
        } else {
            expect(clientId.pathname).toBe('/api/auth/oauth/client-metadata')
        }
    })

    it('reads callback params from explicit href', () => {
        const params = readOAuthParamsFromLocation(
            'https://example.com/login?state=abc#code=123&error=denied'
        )
        expect(params.get('state')).toBe('abc')
        expect(params.get('code')).toBe('123')
        expect(params.get('error')).toBe('denied')
    })
})

describe('at uri conversion', () => {
    it('converts profile at uris to bsky profile urls', () => {
        expect(atUriToBskyUrl('at://alice.bsky.social')).toBe(
            'https://bsky.app/profile/alice.bsky.social'
        )
        expect(atUriToBskyUrl('at://did:plc:alice')).toBe(
            'https://bsky.app/profile/did:plc:alice'
        )
    })

    it('converts post at uris to bsky post urls', () => {
        expect(atUriToBskyUrl(
            'at://did:plc:alice/app.bsky.feed.post/3lf4xabcdef'
        )).toBe(
            'https://bsky.app/profile/did:plc:alice/post/3lf4xabcdef'
        )
    })

    it('converts feed/list/starterpack at uris to corresponding web routes', () => {
        expect(atUriToBskyUrl(
            'at://alice.bsky.social/app.bsky.feed.generator/my-feed'
        )).toBe('https://bsky.app/profile/alice.bsky.social/feed/my-feed')
        expect(atUriToBskyUrl(
            'at://alice.bsky.social/app.bsky.graph.list/my-list'
        )).toBe('https://bsky.app/profile/alice.bsky.social/lists/my-list')
        expect(atUriToBskyUrl(
            'at://did:plc:alice/app.bsky.graph.starterpack/abc123'
        )).toBe('https://bsky.app/starter-pack/did:plc:alice/abc123')
    })

    it('falls back to profile route for unknown record collections', () => {
        expect(atUriToBskyUrl(
            'at://did:plc:alice/com.example.unknown/record-key'
        )).toBe('https://bsky.app/profile/did:plc:alice')
    })

    it('throws for malformed at uris', () => {
        expect(() => atUriToBskyUrl('https://example.com')).toThrow(
            'Invalid AT URI: expected at:// scheme'
        )
        expect(() => atUriToBskyUrl('at:///app.bsky.feed.post/rkey')).toThrow(
            'Invalid AT URI: missing authority'
        )
    })
})

describe('config helpers', () => {
    it('builds did document shape used by feed generator config', () => {
        const doc = did({
            did: 'did:web:example.com',
            host: 'example.com',
            publicKey: 'zExamplePublicKey'
        })

        expect(doc.id).toBe('did:web:example.com')
        expect(doc.service[0].type).toBe('BskyFeedGenerator')
        expect(doc.service[0].serviceEndpoint).toBe('https://example.com')
        expect(doc.verificationMethod[0].controller).toBe('did:web:example.com')
        expect(config.recordName).toBe('drering')
    })
})
