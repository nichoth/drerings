import { schedule, type Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { verifyStampInvariants } from '../lib/stamps.js'

const runStampInvariantVerification:Handler = async function handler () {
    const result = await verifyStampInvariants()

    console.log('Stamp invariant verification completed.', result)

    return json(200, result)
}

export const handler = schedule('30 9 * * *', runStampInvariantVerification)
