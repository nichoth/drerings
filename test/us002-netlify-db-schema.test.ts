import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')
const migrationsDir = path.join(repoRoot, 'netlify/database/migrations')

function readJson (relativePath:string):Record<string, unknown> {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    ) as Record<string, unknown>
}

function normalizeSql (sql:string):string {
    return sql
        .replace(/--.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

function extractTable (sql:string, tableName:string):string {
    const pattern = new RegExp(
        `create table ${tableName} \\((?<body>.*?)\\);`
    )
    const match = pattern.exec(sql)
    return match?.groups?.body || ''
}

describe('US-002 Netlify DB schema', () => {
    it('installs the Netlify Database package', () => {
        const pkg = readJson('package.json') as {
            dependencies?:Record<string, string>;
            devDependencies?:Record<string, string>;
        }
        const packages = {
            ...pkg.dependencies,
            ...pkg.devDependencies
        }

        expect(packages).toHaveProperty('@netlify/database')
    })

    it('defines the paid-account tables in a Netlify migration', () => {
        const migrationFiles = fs
            .readdirSync(migrationsDir, { recursive: true })
            .filter((file):file is string => {
                if (typeof file !== 'string') return false
                return file.endsWith('/migration.sql')
            })
        const migrationSql = migrationFiles
            .map(file => {
                const fullPath = path.join(migrationsDir, file)
                return fs.readFileSync(fullPath, 'utf8')
            })
            .join('\n')
        const sql = normalizeSql(migrationSql)
        const users = extractTable(sql, 'users')
        const passkeys = extractTable(sql, 'passkeys')
        const tokens = extractTable(sql, 'magic_link_tokens')
        const drawings = extractTable(sql, 'drawings')
        const posts = extractTable(sql, 'public_posts')

        expect(users).toContain('id uuid primary key')
        expect(users).toContain('email text not null unique')
        expect(users).toContain('created_at timestamptz not null')
        expect(users).toContain('subscription_status text not null')
        expect(users).toMatch(/subscription_status in \(\s*'free'/)
        expect(users).toContain("'active', 'canceled', 'past_due'")
        expect(users).toContain('autumn_customer_id text')

        expect(passkeys).toContain('id uuid primary key')
        expect(passkeys).toContain(
            'user_id uuid not null references users(id)'
        )
        expect(passkeys).toContain('credential_id text not null unique')
        expect(passkeys).toContain('public_key text not null')
        expect(passkeys).toContain('counter bigint not null')
        expect(passkeys).toContain('created_at timestamptz not null')

        expect(tokens).toContain('token text primary key')
        expect(tokens).toContain('user_id uuid not null references users(id)')
        expect(tokens).toContain('expires_at timestamptz not null')
        expect(tokens).toContain('used_at timestamptz')

        expect(drawings).toContain('id uuid primary key')
        expect(drawings).toContain(
            'user_id uuid not null references users(id)'
        )
        expect(drawings).toContain('blob_key text not null')
        expect(drawings).toContain('text text not null')
        expect(drawings).toContain('alt_text text not null')
        expect(drawings).toContain('created_at timestamptz not null')
        expect(drawings).toContain('updated_at timestamptz not null')

        expect(posts).toContain('id bigserial primary key')
        expect(posts).toContain('drawing_id uuid not null unique')
        expect(posts).toContain('references drawings(id)')
        expect(posts).toContain('published_at timestamptz not null')
    })
})
