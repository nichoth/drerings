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

interface RedirectEntry {
    to:string;
    functionName:string;
}

function parseFunctionRedirects (tomlText:string):RedirectEntry[] {
    // Match every `to = "/.netlify/functions/<name>"` (optionally
    // followed by `/:splat`) inside [[redirects]] blocks. We only
    // care about the function-name portion, so a non-greedy regex is
    // sufficient — no TOML parser dependency.
    const re = (
        /to\s*=\s*"\/\.netlify\/functions\/([a-zA-Z0-9_-]+)(?:\/:splat)?"/g
    )
    const found:RedirectEntry[] = []
    let m:RegExpExecArray|null
    while ((m = re.exec(tomlText)) !== null) {
        found.push({ to: m[0], functionName: m[1] })
    }
    return found
}

function listFunctionFiles ():string[] {
    return fs.readdirSync(functionsDir)
        .filter(name => name.endsWith('.ts'))
        .map(name => name.replace(/\.ts$/, ''))
}

describe('netlify.toml routing alignment (FR-009)', () => {
    it('every function redirect resolves to a file', () => {
        const toml = fs.readFileSync(tomlPath, 'utf8')
        const redirects = parseFunctionRedirects(toml)

        expect(redirects.length).toBeGreaterThan(0)

        for (const r of redirects) {
            const filePath = path.join(
                functionsDir,
                `${r.functionName}.ts`
            )
            expect(
                fs.existsSync(filePath),
                `redirect target ${r.functionName} resolves to ` +
                    `netlify/functions/${r.functionName}.ts`
            ).toBe(true)
        }
    })

    it('every request-routed function file has a redirect', () => {
        const toml = fs.readFileSync(tomlPath, 'utf8')
        const redirectNames = new Set(
            parseFunctionRedirects(toml).map(r => r.functionName)
        )
        const files = listFunctionFiles()

        for (const name of files) {
            if (EXCLUDE_FROM_ROUTING.has(name)) continue
            expect(
                redirectNames.has(name),
                `function file ${name}.ts is referenced by ` +
                    'a redirect'
            ).toBe(true)
        }
    })
})
