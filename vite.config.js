// @ts-check
import { defineConfig } from 'vite'
import browserslist from 'browserslist'
import { browserslistToTargets } from 'lightningcss'
import preact from '@preact/preset-vite'

// Dev proxy: forward browser-visible /api/* paths and the OAuth
// client metadata document to the Netlify Functions runtime on
// 127.0.0.1:9999. This list MUST mirror the [[redirects]] table in
// netlify.toml — see specs/007-split-dev-ports/contracts/dev-routing.md.
const apiRewrites = [
    {
        from: /^\/api\/auth\/login$/,
        to: '/.netlify/functions/auth-login'
    },
    {
        from: /^\/api\/auth\/callback$/,
        to: '/.netlify/functions/auth-callback'
    },
    {
        from: /^\/api\/auth\/logout$/,
        to: '/.netlify/functions/auth-logout'
    },
    {
        from: /^\/api\/shares\/precheck$/,
        to: '/.netlify/functions/shares-precheck'
    },
    {
        from: /^\/api\/shares\/confirm$/,
        to: '/.netlify/functions/shares-confirm'
    },
    {
        from: /^\/api\/postcards\/send$/,
        to: '/.netlify/functions/postcards-send'
    },
    {
        from: /^\/api\/billing\/checkout$/,
        to: '/.netlify/functions/billing-checkout'
    },
    {
        from: /^\/api\/billing\/webhook$/,
        to: '/.netlify/functions/billing-webhook'
    },
    {
        from: /^\/api\/stamps\/lots$/,
        to: '/.netlify/functions/stamps-lots'
    },
    {
        from: /^\/api\/stamps\/transactions$/,
        to: '/.netlify/functions/stamps-transactions'
    },
    {
        from: /^\/api\/stamps\/refund\/(.+)$/,
        to: '/.netlify/functions/stamps-refund/$1'
    },
    {
        from: /^\/api\/stamps\/gifts\/checkout$/,
        to: '/.netlify/functions/stamps-gifts-checkout'
    },
    {
        from: /^\/api\/stamps\/gifts\/refund\/(.+)$/,
        to: '/.netlify/functions/stamps-gifts-refund/$1'
    },
    {
        from: /^\/api\/webhooks\/resend$/,
        to: '/.netlify/functions/webhooks-resend'
    },
    // Directory-based functions: strip the /api prefix, keep the path.
    {
        from: /^\/api\/(whoami|drawings|posts|account)(\/.*)?$/,
        to: '/.netlify/functions/$1$2'
    },
]

/** @param {string} urlPath */
function rewriteApi (urlPath) {
    const qIndex = urlPath.indexOf('?')
    const pathname = qIndex === -1 ? urlPath : urlPath.slice(0, qIndex)
    const query = qIndex === -1 ? '' : urlPath.slice(qIndex)
    for (const r of apiRewrites) {
        if (r.from.test(pathname)) {
            return pathname.replace(r.from, r.to) + query
        }
    }
    return urlPath
}

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        global: 'globalThis'
    },
    plugins: [
        preact({
            devtoolsInProd: false,
            prefreshEnabled: true,
        })
    ],
    // https://github.com/vitejs/vite/issues/8644#issuecomment-1159308803
    esbuild: {
        logOverride: { 'this-is-undefined-in-esm': 'silent' }
    },
    publicDir: '_public',
    css: {
        transformer: 'lightningcss',
        lightningcss: {
            targets: browserslistToTargets(browserslist('>= 0.25%')),
        },
    },
    // Vite is the dev front door on 8888 (the SPA origin).
    // `netlify functions:serve` runs separately on 9999 and is
    // reached via the proxy below.
    server: {
        port: 8888,
        strictPort: true,
        host: true,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:9999',
                changeOrigin: false,
                rewrite: rewriteApi,
            },
            '/.well-known/oauth-client-metadata.json': {
                target: 'http://127.0.0.1:9999',
                changeOrigin: false,
                rewrite: () => '/.netlify/functions/oauth-client-metadata',
            },
        },
    },
    build: {
        cssMinify: 'lightningcss',
        target: 'esnext',
        minify: false,
        outDir: './public',
        emptyOutDir: true,
        sourcemap: 'inline'
    }
})
