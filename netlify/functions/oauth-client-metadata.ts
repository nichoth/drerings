import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { getClientMetadata } from '../lib/auth/atproto.js'

export const handler:Handler = async function handler () {
    return json(200, getClientMetadata(), { cacheControl: 'public, max-age=3600' })
}
