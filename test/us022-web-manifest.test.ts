import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type ManifestIcon = {
    src: string;
    sizes: string;
    type: string;
    purpose: string;
}

type WebManifest = {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: ManifestIcon[];
}

function readManifest ():WebManifest {
    return JSON.parse(
        readFileSync('public/manifest.webmanifest', 'utf8')
    ) as WebManifest
}

function rootColorValues () {
    const css = readFileSync('src/style.css', 'utf8')
    const rootBlock = css.match(/:root\s*{(?<body>[^}]+)}/)?.groups?.body

    expect(rootBlock).toBeDefined()

    const colors = new Set<string>()

    for (const match of rootBlock!.matchAll(
        /--[a-z-]+:\s*(?<value>#[0-9a-fA-F]+|black|white);/g
    )) {
        colors.add(match.groups!.value.toLowerCase())
    }

    return colors
}

describe('US-022 web app manifest', () => {
    it('provides the installable app identity', () => {
        expect(existsSync('public/manifest.webmanifest')).toBe(true)

        expect(readManifest()).toMatchObject({
            name: 'Drerings',
            short_name: 'Drerings',
            start_url: '/',
            scope: '/',
            display: 'standalone'
        })
    })

    it('uses existing global color tokens for PWA colors', () => {
        const manifest = readManifest()
        const colors = rootColorValues()

        expect(colors.has(manifest.background_color.toLowerCase())).toBe(true)
        expect(colors.has(manifest.theme_color.toLowerCase())).toBe(true)
    })

    it('references the generated PWA icon assets', () => {
        expect(readManifest().icons).toEqual([
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-512-maskable.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            }
        ])
    })
})
