import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readme = readFileSync('README.md', 'utf8')

describe('US-020 README deployment notes', () => {
    it('documents production environment variables and services', () => {
        expect(readme).toContain('## Deployment')
        expect(readme).toContain('RESEND_API_KEY')
        expect(readme).toContain('RESEND_FROM_EMAIL')
        expect(readme).toContain('AUTUMN_SECRET_KEY')
        expect(readme).toMatch(/Autumn API key/i)
        expect(readme).toContain('AUTUMN_PRODUCT_ID')
        expect(readme).toContain('AUTUMN_WEBHOOK_SECRET')
        expect(readme).toContain('SESSION_SECRET')
        expect(readme).toMatch(/Netlify Database/i)
        expect(readme).toMatch(/Netlify Blobs/i)
        expect(readme).toContain('drawings')
        expect(readme).toContain('APP_BASE_URL')
    })

    it('documents Autumn webhook configuration', () => {
        expect(readme).toContain('/api/billing/webhook')
        expect(readme).toMatch(/Autumn dashboard/i)
        expect(readme).toMatch(/Svix/i)
    })

    it('documents local development without live providers', () => {
        expect(readme).toMatch(/mocked checkout/i)
        expect(readme).toMatch(/Resend/i)
        expect(readme).toMatch(/NETLIFY_LOCAL=true/i)
        expect(readme).not.toMatch(/Bluesky|AT Proto|OAuth local testing/i)
    })
})
