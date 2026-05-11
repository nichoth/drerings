import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

type WebManifest = {
    theme_color: string;
}

function readPublicIndex () {
    const html = readFileSync('public/index.html', 'utf8')

    return new JSDOM(html).window.document
}

function readManifest () {
    return JSON.parse(
        readFileSync('public/manifest.webmanifest', 'utf8')
    ) as WebManifest
}

describe('US-023 PWA HTML metadata', () => {
    it('advertises the web app manifest', () => {
        const doc = readPublicIndex()
        const manifest = doc.querySelector('link[rel="manifest"]')

        expect(manifest?.getAttribute('href')).toBe('/manifest.webmanifest')
    })

    it('uses the manifest theme color in browser chrome metadata', () => {
        const doc = readPublicIndex()
        const theme = doc.querySelector('meta[name="theme-color"]')

        expect(theme?.getAttribute('content')).toBe(readManifest().theme_color)
    })

    it('advertises the generated Apple touch icon', () => {
        const doc = readPublicIndex()
        const icon = doc.querySelector('link[rel="apple-touch-icon"]')

        expect(icon?.getAttribute('href')).toBe('/icon-192.png')
    })
})
