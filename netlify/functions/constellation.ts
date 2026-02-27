import type { Context } from '@netlify/functions'

const CONSTELLATION_ORIGIN = 'https://constellation.microcosm.blue'
const CONSTELLATION_COUNT_PATH = '/xrpc/blue.microcosm.links.getBacklinksCount'
const LIKE_SOURCE = 'app.bsky.feed.like:subject.uri'
const MAX_URIS = 20

type LikesResponse = {
    counts:Record<string, number>;
}

export default async function handler (req:Request, _context:Context) {
    try {
        if (req.method !== 'GET') {
            return jsonResponse({ error: 'Method not allowed' }, 405)
        }

        const url = new URL(req.url)
        const uris = [...new Set(url.searchParams
            .getAll('uri')
            .map(uri => uri.trim())
            .filter(Boolean))]
            .slice(0, MAX_URIS)

        if (!uris.length) {
            return jsonResponse<LikesResponse>({ counts: {} }, 200)
        }

        if (!uris.every(uri => uri.startsWith('at://'))) {
            return jsonResponse({ error: 'Invalid uri query param' }, 400)
        }

        const counts = await fetchLikeCounts(uris)
        return jsonResponse<LikesResponse>({ counts }, 200)
    } catch (err) {
        return jsonResponse({ error: getErrorMessage(err) }, 500)
    }
}

async function fetchLikeCounts (uris:string[]):Promise<Record<string, number>> {
    const entries = await Promise.all(uris.map(async (uri) => {
        const count = await fetchLikeCount(uri)
        return [uri, count] as const
    }))

    return Object.fromEntries(entries)
}

async function fetchLikeCount (subject:string):Promise<number> {
    const url = new URL(CONSTELLATION_COUNT_PATH, CONSTELLATION_ORIGIN)
    url.searchParams.set('subject', subject)
    url.searchParams.set('source', LIKE_SOURCE)

    try {
        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/json'
            }
        })

        if (!res.ok) return 0

        const raw = await res.text()
        return parseCount(raw)
    } catch {
        return 0
    }
}

function parseCount (rawBody:string):number {
    const body = rawBody.trim()
    if (!body) return 0

    const directNumber = Number(body)
    if (Number.isFinite(directNumber)) {
        return Math.max(0, Math.floor(directNumber))
    }

    try {
        const parsed = JSON.parse(body) as {
            total?:unknown;
            count?:unknown;
        }

        if (typeof parsed.total === 'number' && Number.isFinite(parsed.total)) {
            return Math.max(0, Math.floor(parsed.total))
        }

        if (typeof parsed.count === 'number' && Number.isFinite(parsed.count)) {
            return Math.max(0, Math.floor(parsed.count))
        }
    } catch {
        // ignore parse failures and return zero
    }

    return 0
}

function jsonResponse<T extends Record<string, unknown>> (body:T, status:number):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json'
        }
    })
}

function getErrorMessage (error:unknown):string {
    if (error instanceof Error) return error.message
    return 'Unknown error'
}
