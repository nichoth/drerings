import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')
const forbiddenPackages = [
    '@atproto/api',
    '@atproto/identity',
    '@atproto/oauth-client',
    '@atproto/oauth-client-browser',
    '@atproto/oauth-client-node'
]
const sourceDirs = ['src', 'netlify/functions']
const forbiddenSourcePatterns = [
    /@atproto\//,
    /\batproto\b/i,
    /\bBluesky\b/i,
    /\bbsky\b/i,
    /OAuth/i,
    /at:\/\//
]

function readJson (relativePath:string):Record<string, unknown> {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    ) as Record<string, unknown>
}

function listSourceFiles (relativeDir:string):string[] {
    const dir = path.join(repoRoot, relativeDir)
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(relativeDir, entry.name)
        if (entry.isDirectory()) return listSourceFiles(entryPath)
        if (!entry.name.match(/\.(ts|tsx|js|jsx)$/)) return []
        return [entryPath]
    })
}

describe('US-001 AT Proto removal guard', () => {
    it('removes AT Proto packages from package.json', () => {
        const pkg = readJson('package.json') as {
            dependencies?:Record<string, string>;
            devDependencies?:Record<string, string>;
        }
        const installedPackages = {
            ...pkg.dependencies,
            ...pkg.devDependencies
        }

        for (const dependency of forbiddenPackages) {
            expect(installedPackages).not.toHaveProperty(dependency)
        }
    })

    it('removes AT Proto packages from package-lock.json', () => {
        const lock = readJson('package-lock.json') as {
            packages?:Record<string, unknown>;
        }
        const packageNames = Object.keys(lock.packages || {})

        for (const dependency of forbiddenPackages) {
            expect(packageNames).not.toContain(`node_modules/${dependency}`)
        }
    })

    it('removes Bluesky and AT Proto source references', () => {
        const offenders = sourceDirs
            .flatMap(listSourceFiles)
            .flatMap(file => {
                const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
                const matches = forbiddenSourcePatterns.filter(pattern => {
                    return pattern.test(text)
                })
                return matches.length ? [file] : []
            })

        expect(offenders).toEqual([])
    })
})
