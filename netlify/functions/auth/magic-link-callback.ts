import type { Handler } from '@netlify/functions'
import { consumeMagicLinkToken } from '../../lib/auth-store.js'
import { createSessionCookie } from '../../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: 'Method not allowed'
        }
    }

    const token = event.queryStringParameters?.token

    if (!token) return errorPage()

    try {
        const user = await consumeMagicLinkToken(token)

        if (!user) return errorPage()

        return {
            statusCode: 302,
            headers: {
                Location: '/',
                'Set-Cookie': createSessionCookie(user)
            }
        }
    } catch (err) {
        console.error(err)
        return errorPage()
    }
}

function errorPage () {
    return {
        statusCode: 400,
        headers: {
            'Content-Type': 'text/html; charset=utf-8'
        },
        body: `<!doctype html>
            <html lang="en">
                <head>
                    <meta charset="utf-8">
                    <title>Magic link expired</title>
                </head>
                <body>
                    <h1>This sign-in link expired or already used.</h1>
                    <p>
                        Go back to <a href="/login">login</a> for a new link.
                    </p>
                </body>
            </html>`
    }
}
