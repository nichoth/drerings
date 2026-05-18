import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { sessionStore, stateStore } from './atproto-stores.js'

const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:9999'

function getOrigin ():string {
    const env = process.env.PUBLIC_URL
    if (env) return env.replace(/\/$/, '')

    return DEFAULT_LOCAL_ORIGIN
}

function getClientId (origin:string):string {
    const isLocal = origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://localhost')

    if (isLocal) {
        const redirect = encodeURIComponent(
            `${origin}/api/auth/callback`
        )
        const scope = encodeURIComponent('atproto transition:generic')

        return `http://localhost?redirect_uri=${redirect}`
            + `&scope=${scope}`
    }

    return `${origin}/.well-known/oauth-client-metadata.json`
}

export function getClientMetadata ():object {
    const origin = getOrigin()
    const clientId = getClientId(origin)

    return {
        client_id: clientId,
        client_name: 'drerings',
        client_uri: origin,
        redirect_uris: [`${origin}/api/auth/callback`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        dpop_bound_access_tokens: true,
        token_endpoint_auth_method: 'none'
    }
}

let cached:NodeOAuthClient|null = null

export function getOAuthClient ():NodeOAuthClient {
    if (cached) return cached

    cached = new NodeOAuthClient({
        clientMetadata: getClientMetadata() as never,
        sessionStore,
        stateStore
    })

    return cached
}
