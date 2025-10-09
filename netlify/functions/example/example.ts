import type { Context, Config } from '@netlify/functions'

export default async (req:Request, context:Context) => {
    const { param, splat } = context.params
    if (req.method !== 'GET') {
        return new Response(null, { status: 405 })
    }

    return Response.json({ param, splat }, {
        status: 200,
        headers: {
            // see https://docs.netlify.com/platform/caching/#durable-directive
            'Netlify-CDN-Cache-Control': 'public, durable, max-age=60, stale-while-revalidate=120'
        }
    })
}

export const config:Config = {
    path: ['/api/example/:param?', '/api/example/splat/*']
}
