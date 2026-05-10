import crypto from 'node:crypto'
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

function getSessionSecret ():string {
    if (process.env.SESSION_SECRET) {
        return process.env.SESSION_SECRET
    }

    if (process.env.NODE_ENV === 'test' || process.env.NETLIFY_LOCAL) {
        return 'dev-session-secret'
    }

    throw new Error('SESSION_SECRET is required')
}
