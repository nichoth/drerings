// @ts-check
// vite.config.js
import { defineConfig } from 'vite'
import browserslist from 'browserslist'
import { browserslistToTargets } from 'lightningcss'
import preact from '@preact/preset-vite'
import netlify from '@netlify/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        global: 'globalThis'
    },
    plugins: [
        netlify(),
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
    // Vite is the only dev process. `@netlify/vite-plugin`
    // (registered above) emulates Netlify Functions, Edge
    // Functions, blobs, headers, redirects, and provisions a
    // local Netlify Database in `.netlify/db/` — all reached
    // through the same `:8888` origin via the plugin's middleware.
    server: {
        port: 8888,
        strictPort: true,
        host: true,
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
