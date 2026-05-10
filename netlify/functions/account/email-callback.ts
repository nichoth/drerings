import type { Handler } from '@netlify/functions'
import { confirmEmailUpdate } from '../../lib/account.js'
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
        const user = await confirmEmailUpdate(token)

        if (!user) return errorPage()

        return {
            statusCode: 302,
            headers: {
                Location: '/account?email=ok',
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
                    <title>Email update expired</title>
                </head>
                <body>
                    <h1>
                        This email update link expired or was already used.
                    </h1>
                    <p>
                        Go back to <a href="/account">account</a> for a new
                        link.
                    </p>
                </body>
            </html>`
    }
}
