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

describe('US-001 stamp accounting schema migration', () => {
    it('adds stamp accounting schema with additive forward SQL', () => {
        const forwardSql = normalizeSql(readMigrationSql('migration.sql'))
        const stampLots = extractTable(forwardSql, 'stamp_lots')
        const stampTx = extractTable(forwardSql, 'stamp_transactions')

        expect(forwardSql).not.toMatch(/\bdrop\s+(table|column)\b/)
        expect(forwardSql).toContain(
            'alter table users add column stamps_balance ' +
            'integer not null default 0'
        )

        expect(stampLots).toContain('id uuid primary key')
        expect(stampLots).toContain(
            'user_id uuid not null references users(id)'
        )
        expect(stampLots).toContain('source text not null')
        expect(stampLots).toContain('original_count integer not null')
        expect(stampLots).toContain('remaining_count integer not null')
        expect(stampLots).toContain('price_paid_cents integer')
        expect(stampLots).toContain('autumn_checkout_id text')
        expect(stampLots).toContain(
            'gifted_by_user_id uuid references users(id)'
        )
        expect(stampLots).toContain('created_at timestamptz not null')
        expect(stampLots).toContain('remaining_count >= 0')
        expect(stampLots).toContain(
            'remaining_count <= original_count'
        )
        expect(stampLots).toContain('original_count > 0')
        expect(stampLots).toMatch(/source in \(\s*'purchase'/)
        expect(stampLots).toContain("'grant', 'gift_received'")

        expect(forwardSql).toContain('create index idx_lots_consumption')
        expect(forwardSql).toContain(
            'on stamp_lots(user_id, source, created_at)'
        )
        expect(forwardSql).toContain('where remaining_count > 0')

        expect(stampTx).toContain('id uuid primary key')
        expect(stampTx).toContain(
            'user_id uuid not null references users(id)'
        )
        expect(stampTx).toContain('lot_id uuid references stamp_lots(id)')
        expect(stampTx).toContain('delta integer not null')
        expect(stampTx).toContain('reason text not null')
        expect(stampTx).toContain('reference_id text')
        expect(stampTx).toContain('balance_after integer not null')
        expect(stampTx).toContain('created_at timestamptz not null')
        expect(stampTx).toMatch(/reason in \(\s*'purchase'/)
        expect(stampTx).toContain("'grant', 'migration_grant'")
        expect(stampTx).toContain("'send', 'refund'")
        expect(stampTx).toContain("'gift_sent', 'gift_received'")
        expect(stampTx).toContain("'failed_send_refund'")

        expect(forwardSql).toContain(
            'create index idx_stamp_tx_user_created'
        )
        expect(forwardSql).toContain(
            'on stamp_transactions(user_id, created_at desc)'
        )
    })

    it('provides a rollback that removes only stamp accounting schema', () => {
        const downFiles = migrationFiles('down.sql')
        const rollbackSql = normalizeSql(readMigrationSql('down.sql'))

        expect(downFiles.length).toBeGreaterThan(0)
        expect(rollbackSql).toContain(
            'drop table if exists stamp_transactions'
        )
        expect(rollbackSql).toContain('drop table if exists stamp_lots')
        expect(rollbackSql).toContain(
            'alter table users drop column if exists stamps_balance'
        )
        expect(rollbackSql).not.toMatch(/\bdrop\s+table\s+users\b/)
    })
})
