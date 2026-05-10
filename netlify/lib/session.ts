import crypto from 'node:crypto'
import type { HandlerEvent } from '@netlify/functions'
import type { SessionUser } from './auth-store.js'

const COOKIE_NAME = 'drerings_session'

export function createSessionCookie (user:SessionUser):string {
    const payload = Buffer.from(JSON.stringify({
        id: user.id,
        email: user.email,
        subscription_status: user.subscription_status,
        issued_at: new Date().toISOString()
    })).toString('base64url')
    const signature = crypto
        .createHmac('sha256', getSessionSecret())
        .update(payload)
        .digest('base64url')
    const maxAge = 60 * 60 * 24 * 30

    return [
        `${COOKIE_NAME}=${payload}.${signature}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        `Max-Age=${maxAge}`
    ].join('; ')
}

export function readSessionUserFromCookie (
    event:HandlerEvent
):SessionUser|null {
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie)
    const session = cookies[COOKIE_NAME]

    if (!session) return null

    const [payload, signature] = session.split('.')

    if (!payload || !signature) return null

    const expected = crypto
        .createHmac('sha256', getSessionSecret())
        .update(payload)
        .digest('base64url')

    if (!isEqualSignature(signature, expected)) return null

    try {
        const body = JSON.parse(
            Buffer.from(payload, 'base64url').toString('utf8')
        ) as SessionUser

        if (!isSessionUser(body)) return null

        return {
            id: body.id,
            email: body.email,
            subscription_status: body.subscription_status
        }
    } catch {
        return null
    }
}

export function getSessionSecret ():string {
    if (process.env.SESSION_SECRET) {
        return process.env.SESSION_SECRET
    }

    if (process.env.NODE_ENV === 'test' || process.env.NETLIFY_LOCAL) {
        return 'dev-session-secret'
    }

    throw new Error('SESSION_SECRET is required')
}

function parseCookies (
    value:string|undefined
):Record<string, string> {
    if (!value) return {}

    return value
        .split(';')
        .map(cookie => cookie.trim())
        .filter(Boolean)
        .reduce<Record<string, string>>((acc, cookie) => {
            const [name, ...parts] = cookie.split('=')

            if (!name) return acc

            acc[name] = parts.join('=')

            return acc
        }, {})
}

function isEqualSignature (left:string, right:string):boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)

    if (leftBuffer.length !== rightBuffer.length) return false

    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function isSessionUser (value:unknown):value is SessionUser {
    if (!value || typeof value !== 'object') return false

    const maybeUser = value as Partial<SessionUser>
    const statuses = ['free', 'active', 'canceled', 'past_due']

    return typeof maybeUser.id === 'string' &&
        typeof maybeUser.email === 'string' &&
        statuses.includes(String(maybeUser.subscription_status))
}
