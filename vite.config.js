// @ts-check
import { defineConfig } from 'vite'
import browserslist from 'browserslist'
import { browserslistToTargets } from 'lightningcss'
import preact from '@preact/preset-vite'

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
                rewrite: (path) => '/.netlify/functions' + path.slice(4),
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
