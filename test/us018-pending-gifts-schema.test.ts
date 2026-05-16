import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')
const migrationsDir = path.join(repoRoot, 'netlify/database/migrations')

function migrationFiles (fileName:string):string[] {
    return fs
        .readdirSync(migrationsDir, { recursive: true })
        .filter((file):file is string => {
            if (typeof file !== 'string') return false
            return file.endsWith(`/${fileName}`)
        })
}

function readMigrationSql (fileName:string):string {
    return migrationFiles(fileName)
        .map(file => {
            const fullPath = path.join(migrationsDir, file)
            return fs.readFileSync(fullPath, 'utf8')
        })
        .join('\n')
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

describe('US-018 pending gifts schema migration', () => {
    it('adds pending gift records with the required accounting fields', () => {
        const forwardSql = normalizeSql(readMigrationSql('migration.sql'))
        const pendingGifts = extractTable(forwardSql, 'pending_gifts')

        expect(pendingGifts).toContain('id uuid primary key')
        expect(pendingGifts).toContain(
            'sender_user_id uuid not null references users(id)'
        )
        expect(pendingGifts).toContain('recipient_email text not null')
        expect(pendingGifts).toContain('pack_id text not null')
        expect(pendingGifts).toContain('count integer not null')
        expect(pendingGifts).toContain('price_cents integer not null')
        expect(pendingGifts).toContain('autumn_checkout_id text not null')
        expect(pendingGifts).toContain('created_at timestamptz not null')
        expect(pendingGifts).toContain(
            "status text not null default 'pending'"
        )
        expect(pendingGifts).toContain(
            "status in ('pending', 'claimed', 'refunded')"
        )
        expect(forwardSql).toContain(
            'create unique index idx_pending_gifts_checkout'
        )
        expect(forwardSql).toContain(
            'create index idx_pending_gifts_sender_status'
        )
    })

    it('rolls pending gifts back without touching user data', () => {
        const rollbackSql = normalizeSql(readMigrationSql('down.sql'))

        expect(rollbackSql).toContain('drop table if exists pending_gifts')
        expect(rollbackSql).not.toMatch(/\bdrop\s+table\s+users\b/)
    })
})
