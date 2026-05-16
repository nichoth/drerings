import { getDatabase } from '@netlify/database'
import { creditStampLot } from './stamps.js'

const MIGRATION_GRANT_STAMPS = 10

export interface BackfillExistingUserStampsOptions {
    dryRun?:boolean;
    log?:(message:string) => void;
}

export interface BackfillExistingUserStampsResult {
    dryRun:boolean;
    usersProcessed:number;
    usersSkipped:number;
    stampsGranted:number;
}

interface UserRow {
    id:string;
}

interface TransactionRow {
    id:string;
}

export async function backfillExistingUserStamps (
    options:BackfillExistingUserStampsOptions = {}
):Promise<BackfillExistingUserStampsResult> {
    const db = getDatabase()
    const dryRun = options.dryRun ?? false
    const users = await db.pool.query<UserRow>(`
        SELECT id
        FROM users
        ORDER BY created_at ASC
    `)
    let usersSkipped = 0
    let stampsGranted = 0

    for (const user of users.rows) {
        const existingGrant = await db.pool.query<TransactionRow>(`
            SELECT id
            FROM stamp_transactions
            WHERE user_id = $1
                AND reason = 'migration_grant'
            LIMIT 1
        `, [user.id])

        if (existingGrant.rows[0]) {
            usersSkipped += 1
            continue
        }

        stampsGranted += MIGRATION_GRANT_STAMPS

        if (dryRun) continue

        await creditStampLot({
            userId: user.id,
            source: 'grant',
            count: MIGRATION_GRANT_STAMPS,
            priceCents: null,
            transactionReason: 'migration_grant'
        })
    }

    const result = {
        dryRun,
        usersProcessed: users.rows.length,
        usersSkipped,
        stampsGranted
    }

    options.log?.(`Users processed: ${result.usersProcessed}`)
    options.log?.(`Users skipped: ${result.usersSkipped}`)
    options.log?.(`Stamps granted: ${result.stampsGranted}`)
    options.log?.(`Dry run: ${result.dryRun}`)

    return result
}
