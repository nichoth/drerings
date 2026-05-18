import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function readJson (relativePath:string):Record<string, unknown> {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    ) as Record<string, unknown>
}

describe('US-001 atproto dependencies', () => {
    it('atproto dependencies are present in package.json', () => {
        const pkg = readJson('package.json') as {
            dependencies?:Record<string, string>;
            devDependencies?:Record<string, string>;
        }
        const installedPackages = {
            ...pkg.dependencies,
            ...pkg.devDependencies
        }

        expect(installedPackages).toHaveProperty('@atproto/api')
        expect(installedPackages).toHaveProperty('@atproto/identity')
        expect(installedPackages).toHaveProperty('@atproto/oauth-client-node')
    })

    it('atproto packages are in package-lock.json', () => {
        const lock = readJson('package-lock.json') as {
            packages?:Record<string, unknown>;
        }
        const packageNames = Object.keys(lock.packages || {})

        expect(packageNames).toContain('node_modules/@atproto/api')
        expect(packageNames).toContain('node_modules/@atproto/identity')
        expect(packageNames).toContain('node_modules/@atproto/oauth-client-node')
    })
})
