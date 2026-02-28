import type {
    BrowserOAuthClient as BrowserOAuthClientType
} from '@atproto/oauth-client-browser'
// import Debug from '@substrate-system/debug'
// const debug = Debug('drerings:util')

export const OAUTH_CALLBACK_PATH = '/login'
export const OAUTH_SCOPE = 'atproto transition:generic'
export const HANDLE_RESOLVER_URL = 'https://bsky.social'
export const BSKY_WEB_ORIGIN = 'https://bsky.app'

let oauthClientPromise:Promise<BrowserOAuthClientType>|null = null

export function paramsFromQueryLike (query:string):URLSearchParams {
    return new URLSearchParams(query.replace(/^[?#]/, ''))
}

export function oauthParamsFromUrlLike (urlLike:URL|string):URLSearchParams {
    const url = typeof urlLike === 'string' ?
        new URL(urlLike, window.location.origin) :
        urlLike

    const params = paramsFromQueryLike(url.search)
    const rawHash = url.hash.replace(/^#/, '')
    if (!rawHash) return params

    const hashQuery = rawHash.includes('?') ?
        rawHash.split('?').slice(1).join('?') :
        rawHash

    const hashParams = paramsFromQueryLike(hashQuery)
    for (const [key, value] of hashParams.entries()) {
        if (!params.has(key)) params.set(key, value)
    }

    return params
}

interface ParsedAtUri {
    authority:string;
    collection:string|null;
    rkey:string|null;
}

export function atUriToBskyUrl (atUri:string):string {
    const { authority, collection, rkey } = parseAtUri(atUri)
    const actor = encodeAtUriPathPart(authority)

    if (!collection || collection === 'app.bsky.actor.profile') {
        return `${BSKY_WEB_ORIGIN}/profile/${actor}`
    }

    if (!rkey) {
        return `${BSKY_WEB_ORIGIN}/profile/${actor}`
    }

    const recordKey = encodeAtUriPathPart(rkey)

    switch (collection) {
        case 'app.bsky.feed.post':
            return `${BSKY_WEB_ORIGIN}/profile/${actor}/post/${recordKey}`
        case 'app.bsky.feed.generator':
            return `${BSKY_WEB_ORIGIN}/profile/${actor}/feed/${recordKey}`
        case 'app.bsky.graph.list':
            return `${BSKY_WEB_ORIGIN}/profile/${actor}/lists/${recordKey}`
        case 'app.bsky.graph.starterpack':
            return `${BSKY_WEB_ORIGIN}/starter-pack/${actor}/${recordKey}`
        default:
            return `${BSKY_WEB_ORIGIN}/profile/${actor}`
    }
}

export function oauthRedirectUri ():string {
    const redirect = new URL(OAUTH_CALLBACK_PATH, window.location.origin)

    // Bluesky local OAuth callbacks should use 127.0.0.1, not localhost.
    if (redirect.hostname === 'localhost') {
        redirect.hostname = '127.0.0.1'
    }

    return redirect.toString()
}

export function isLoopbackHost (hostname:string):boolean {
    return hostname === '127.0.0.1' ||
        hostname === 'localhost' ||
        hostname === '::1' ||
        hostname === '[::1]'
}

export function oauthClientId ():string {
    const redirectUri = oauthRedirectUri()
    const scope = OAUTH_SCOPE
    const hostname = new URL(redirectUri).hostname

    if (isLoopbackHost(hostname)) {
        const clientId = new URL('http://localhost')
        clientId.searchParams.set('redirect_uri', redirectUri)
        clientId.searchParams.set('scope', scope)
        return clientId.toString()
    }

    const clientId = new URL(
        '/api/auth/oauth/client-metadata',
        window.location.origin
    )
    clientId.searchParams.set('redirect_uri', redirectUri)
    clientId.searchParams.set('scope', scope)
    return clientId.toString()
}

export async function getOAuthClient ():Promise<BrowserOAuthClientType> {
    if (!oauthClientPromise) {
        oauthClientPromise = (async () => {
            const { BrowserOAuthClient } = await import(
                '@atproto/oauth-client-browser'
            )
            return BrowserOAuthClient.load({
                clientId: oauthClientId(),
                responseMode: 'query',
                handleResolver: HANDLE_RESOLVER_URL
            })
        })()
    }

    return oauthClientPromise
}

/**
 * True when URL looks like an OAuth callback redirect.
 */
export const hasOAuthCallback = function (
    query:URLSearchParams|string
):boolean {
    const params = typeof query === 'string' ?
        new URLSearchParams(query.replace(/^\?/, '')) :
        query
    return (
        params.has('state') &&
        (params.has('code') || params.has('error'))
    )
}

/**
 * Read OAuth callback params from current location search + hash.
 */
export const readOAuthParamsFromLocation = function (
    locationHref:string = window.location.href
):URLSearchParams {
    return oauthParamsFromUrlLike(locationHref)
}

function parseAtUri (atUri:string):ParsedAtUri {
    const input = atUri.trim()
    if (!input.startsWith('at://')) {
        throw new Error('Invalid AT URI: expected at:// scheme')
    }

    const withoutScheme = input.slice('at://'.length)
    const withoutHash = withoutScheme.split('#')[0]
    const withoutQuery = withoutHash.split('?')[0]
    const parts = withoutQuery.split('/')
    const rawAuthority = parts.shift() || ''

    if (!rawAuthority) {
        throw new Error('Invalid AT URI: missing authority')
    }

    const authority = decodeURIComponent(rawAuthority)
    const segments = parts.filter(Boolean).map(decodeURIComponent)

    if (segments.length > 2) {
        throw new Error('Invalid AT URI: too many path segments')
    }

    return {
        authority,
        collection: segments[0] || null,
        rkey: segments[1] || null
    }
}

function encodeAtUriPathPart (value:string):string {
    return encodeURIComponent(value).replace(/%3A/gi, ':')
}

export function canvasToSquareBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    if (canvas.width === canvas.height) {
        return canvasToBlob(canvas, type)
    }

    const side = Math.max(canvas.width, canvas.height)
    const squareCanvas = document.createElement('canvas')
    squareCanvas.width = side
    squareCanvas.height = side

    const context = squareCanvas.getContext('2d')
    if (!context) {
        return Promise.reject(
            new Error('Could not create square image context')
        )
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, side, side)
    const x = Math.floor((side - canvas.width) / 2)
    const y = Math.floor((side - canvas.height) / 2)
    context.drawImage(canvas, x, y)

    return canvasToBlob(squareCanvas, type)
}

export function canvasToBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                return reject(new Error('Could not encode drawing image'))
            }
            resolve(blob)
        }, type)
    })
}
