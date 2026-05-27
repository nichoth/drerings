import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')
const tomlPath = path.join(repoRoot, 'netlify.toml')
const functionsDir = path.join(repoRoot, 'netlify', 'functions')

// Function files that exist but are not request-routed
// (scheduled jobs). See specs/006-fix-auth-login-404/contracts/
// routing.md for the rationale.
const EXCLUDE_FROM_ROUTING:ReadonlySet<string> = new Set([
    'refund-expired-gifts',
    'verify-stamp-invariants',
])

function listFunctionFiles ():string[] {
    return fs.readdirSync(functionsDir)
        .filter(name => name.endsWith('.ts'))
        .map(name => name.replace(/\.ts$/, ''))
}

describe('netlify.toml routing alignment (FR-009)', () => {
    it('has the /api/* splat redirect', () => {
        const toml = fs.readFileSync(tomlPath, 'utf8')

        expect(toml).toMatch(
            /from\s*=\s*"\/api\/\*"\s*\n\s*to\s*=\s*"\/\.netlify\/functions\/:splat"/
        )
    })

    it('has the oauth-client-metadata explicit redirect', () => {
        const toml = fs.readFileSync(tomlPath, 'utf8')

        expect(toml).toMatch(
            /from\s*=\s*"\/\.well-known\/oauth-client-metadata\.json"\s*\n\s*to\s*=\s*"\/\.netlify\/functions\/oauth-client-metadata"/
        )
    })

    it('every request-routed function is splat-reachable', () => {
        // Under the splat /api/* -> /.netlify/functions/:splat,
        // a function file is reachable iff its filename (minus .ts)
        // is a single URL segment — i.e. it lives directly under
        // netlify/functions/ with no subdirectory. The directory
        // listing only includes flat .ts files; if a subdirectory
        // ever reappears, the listFunctionFiles helper would skip
        // it and this assertion would still hold (but a follow-up
        // test could be added).
        const files = listFunctionFiles()
        const routable = files.filter(
            name => !EXCLUDE_FROM_ROUTING.has(name)
        )

        expect(routable.length).toBeGreaterThan(0)

        for (const name of routable) {
            expect(
                name.includes('/'),
                `function file ${name}.ts must be a single ` +
                    'segment (no subdirectories) to be splat-' +
                    'routable',
            ).toBe(false)
        }
    })
})
