import { type DidDocument } from '@atproto/identity'

const RECORD_NAME = 'drering'
const TAG = 'drering'

/**
 * Create a DID format document via `@atproto/identity`.
 * @returns DID document
 */
export function did ({ did, host, publicKey }:{
    did:string;
    host:string;
    publicKey:string;
}):DidDocument {
    return {
        id: did,
        service: [
            {
                id: '#bsky_fg',
                type: 'BskyFeedGenerator',
                serviceEndpoint: `https://${host}`,
            }
        ],
        verificationMethod: [
            {
                id: `did:web:${host}#atproto`,
                type: 'Multikey',
                controller: `did:web:${host}`,
                publicKeyMultibase: publicKey
            }
        ]
    }
}

// Hardcoded config for Cloudflare Workers
export const config = {
    recordName: RECORD_NAME,
    serviceName: 'drerings',
    description: 'drawings of things?',
    // Keywords to match in posts (hashtags, text content)
    keywords: [TAG],
    // Scoring weights for feed ranking
    scoring: {
        likeWeight: 1,
        repostWeight: 2,
        replyWeight: 1.5,
        timeDecayHours: 48
    }
}
