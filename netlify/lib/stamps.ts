import { getDatabase } from '@netlify/database'

export interface CreditStampLotOptions {
    userId:string;
    source:'purchase'|'grant'|'gift_received';
    count:number;
    priceCents?:number|null;
    autumnCheckoutId?:string;
    giftedByUserId?:string;
}

export interface CreditStampLotResult {
    lotId:string;
    balanceAfter:number;
}

export interface DebitStampOptions {
    userId:string;
    referenceId?:string;
}

export interface DebitStampResult {
    lotId:string;
    balanceAfter:number;
}

export interface RefundFailedSendOptions {
    userId:string;
    lotId:string;
}

interface QueryResult<Row> {
    rows:Row[];
}

interface DatabaseClient {
    query:<Row = Record<string, unknown>>(
        sql:string,
        params?:unknown[]
    ) => Promise<QueryResult<Row>>;
    release:() => void;
}

interface StampLotRow {
    id:string;
}

interface BalanceRow {
    stamps_balance:number|string;
}

export class InsufficientStampsError extends Error {
    constructor () {
        super('Insufficient stamps.')
        this.name = 'InsufficientStampsError'
    }
}

export async function creditStampLot (
    options:CreditStampLotOptions
):Promise<CreditStampLotResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        const lotResult = await client.query<StampLotRow>(`
            INSERT INTO stamp_lots (
                user_id,
                source,
                original_count,
                remaining_count,
                price_paid_cents,
                autumn_checkout_id,
                gifted_by_user_id
            )
            VALUES ($1, $2, $3, $3, $4, $5, $6)
            RETURNING id
        `, [
            options.userId,
            options.source,
            options.count,
            options.priceCents ?? null,
            options.autumnCheckoutId,
            options.giftedByUserId
        ])
        const lotId = lotResult.rows[0].id

        const balanceResult = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance + $1
            WHERE id = $2
            RETURNING stamps_balance
        `, [options.count, options.userId])
        const balanceAfter = Number(balanceResult.rows[0].stamps_balance)

        await client.query(`
            INSERT INTO stamp_transactions (
                user_id,
                lot_id,
                delta,
                reason,
                reference_id,
                balance_after
            )
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            options.userId,
            lotId,
            options.count,
            options.source,
            options.autumnCheckoutId,
            balanceAfter
        ])

        await client.query('COMMIT')

        return { lotId, balanceAfter }
    } catch (error) {
        await client.query('ROLLBACK')

        throw error
    } finally {
        client.release()
    }
}

export async function debitStamp (
    options:DebitStampOptions
):Promise<DebitStampResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        const lotResult = await client.query<StampLotRow>(`
            UPDATE stamp_lots
            SET remaining_count = remaining_count - 1
            WHERE id = (
                SELECT id
                FROM stamp_lots
                WHERE user_id = $1
                    AND remaining_count > 0
                ORDER BY
                    CASE source WHEN 'purchase' THEN 1 ELSE 0 END,
                    created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id
        `, [options.userId])

        if (!lotResult.rows[0]) {
            throw new InsufficientStampsError()
        }

        const lotId = lotResult.rows[0].id
        const balanceResult = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance - 1
            WHERE id = $1
                AND stamps_balance > 0
            RETURNING stamps_balance
        `, [options.userId])

        if (!balanceResult.rows[0]) {
            throw new InsufficientStampsError()
        }

        const balanceAfter = Number(balanceResult.rows[0].stamps_balance)

        await client.query(`
            INSERT INTO stamp_transactions (
                user_id,
                lot_id,
                delta,
                reason,
                reference_id,
                balance_after
            )
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            options.userId,
            lotId,
            -1,
            'send',
            options.referenceId,
            balanceAfter
        ])

        await client.query('COMMIT')

        return { lotId, balanceAfter }
    } catch (error) {
        await client.query('ROLLBACK')

        throw error
    } finally {
        client.release()
    }
}

export async function refundFailedSend (
    options:RefundFailedSendOptions
):Promise<DebitStampResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        await client.query(`
            UPDATE stamp_lots
            SET remaining_count = remaining_count + 1
            WHERE id = $1
                AND user_id = $2
        `, [options.lotId, options.userId])

        const balanceResult = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance + 1
            WHERE id = $1
            RETURNING stamps_balance
        `, [options.userId])
        const balanceAfter = Number(balanceResult.rows[0].stamps_balance)

        await client.query(`
            INSERT INTO stamp_transactions (
                user_id,
                lot_id,
                delta,
                reason,
                reference_id,
                balance_after
            )
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            options.userId,
            options.lotId,
            1,
            'failed_send_refund',
            undefined,
            balanceAfter
        ])

        await client.query('COMMIT')

        return {
            lotId: options.lotId,
            balanceAfter
        }
    } catch (error) {
        await client.query('ROLLBACK')

        throw error
    } finally {
        client.release()
    }
}
