import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')
const netlifyTomlPath = path.join(repoRoot, 'netlify.toml')

function readNetlifyToml ():string {
    return fs.readFileSync(netlifyTomlPath, 'utf8')
}

describe('Phase 5 — CORS lockdown', () => {
    it(
        'AC16.1: netlify.toml has no Access-Control-Allow-Origin = "*"',
        () => {
            const content = readNetlifyToml()
            const hasWildcard = /Access-Control-Allow-Origin\s*=\s*"\*"/.test(
                content
            )
            expect(hasWildcard).toBe(false)
        }
    )

    it(
        'AC16.2: netlify.toml has no ' +
        'Access-Control-Allow-Credentials = "true"',
        () => {
            const content = readNetlifyToml()
            const hasCredentialsTrue = (
                /Access-Control-Allow-Credentials\s*=\s*"true"/.test(content)
            )
            expect(hasCredentialsTrue).toBe(false)
        }
    )
})

describe('Phase 6 — security headers', () => {
    it('AC17.1: HSTS header is configured', () => {
        const content = readNetlifyToml()
        const hstsPattern = (
            /Strict-Transport-Security\s*=\s*"max-age=63072000;/
        )
        expect(content).toMatch(hstsPattern)
        expect(content).toMatch(/includeSubDomains/)
        expect(content).toMatch(/preload/)
    })

    it('AC17.2: X-Frame-Options is set to DENY', () => {
        const content = readNetlifyToml()
        expect(content).toMatch(
            /X-Frame-Options\s*=\s*"DENY"/
        )
    })

    it('AC17.3: X-Content-Type-Options is set to nosniff', () => {
        const content = readNetlifyToml()
        expect(content).toMatch(
            /X-Content-Type-Options\s*=\s*"nosniff"/
        )
    })

    it(
        'AC17.4: Referrer-Policy is set to ' +
        'strict-origin-when-cross-origin',
        () => {
            const content = readNetlifyToml()
            expect(content).toMatch(
                /Referrer-Policy\s*=\s*"strict-origin-when-cross-origin"/
            )
        }
    )

    it('AC17.5: Permissions-Policy is restrictive', () => {
        const content = readNetlifyToml()
        expect(content).toMatch(/Permissions-Policy\s*=\s*"/)
        expect(content).toMatch(/camera=\(\)/)
        expect(content).toMatch(/microphone=\(\)/)
        expect(content).toMatch(/geolocation=\(\)/)
    })
})

describe('Phase 6 — Content Security Policy (report-only)', () => {
    it('AC18.1: Content-Security-Policy-Report-Only header is present',
        () => {
            const content = readNetlifyToml()
            expect(content).toMatch(
                /Content-Security-Policy-Report-Only\s*=/
            )
        }
    )

    it(
        'AC18.2: CSP includes script-src, style-src, ' +
        'img-src, and connect-src directives',
        () => {
            const content = readNetlifyToml()
            const cspMatch = content.match(
                /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/
            )
            expect(cspMatch).not.toBeNull()

            const cspValue = cspMatch?.[1] ?? ''
            expect(cspValue).toMatch(/script-src 'self'/)
            expect(cspValue).toMatch(/style-src 'self'/)
            expect(cspValue).toMatch(/img-src 'self' data: blob:/)
            expect(cspValue).toMatch(/connect-src 'self'/)
        }
    )

    it('AC18.3: CSP allows frame-src https://github.com', () => {
        const content = readNetlifyToml()
        const cspMatch = content.match(
            /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/
        )
        expect(cspMatch).not.toBeNull()

        const cspValue = cspMatch?.[1] ?? ''
        expect(cspValue).toMatch(/frame-src https:\/\/github\.com/)
    })

    it("AC18.4: CSP sets frame-ancestors to 'none'", () => {
        const content = readNetlifyToml()
        const cspMatch = content.match(
            /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/
        )
        expect(cspMatch).not.toBeNull()

        const cspValue = cspMatch?.[1] ?? ''
        expect(cspValue).toMatch(/frame-ancestors 'none'/)
    })

    it("AC18.5: CSP sets object-src to 'none'", () => {
        const content = readNetlifyToml()
        const cspMatch = content.match(
            /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/
        )
        expect(cspMatch).not.toBeNull()

        const cspValue = cspMatch?.[1] ?? ''
        expect(cspValue).toMatch(/object-src 'none'/)
    })

    it(
        "AC18.6: CSP sets base-uri and form-action to 'self'",
        () => {
            const content = readNetlifyToml()
            const cspMatch = content.match(
                /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/
            )
            expect(cspMatch).not.toBeNull()

            const cspValue = cspMatch?.[1] ?? ''
            expect(cspValue).toMatch(/base-uri 'self'/)
            expect(cspValue).toMatch(/form-action 'self'/)
        }
    )
})
