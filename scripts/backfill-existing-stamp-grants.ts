import { backfillExistingUserStamps } from '../netlify/lib/stamp-backfill.js'

const dryRun = process.argv.includes('--dry-run')

await backfillExistingUserStamps({
    dryRun,
    log: console.log
})
