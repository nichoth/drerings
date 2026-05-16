import { getDatabase } from '@netlify/database'

type StampTransactionReason =
    'purchase'|
    'grant'|
    'migration_grant'|
    'gift_sent'|
    'gift_received'

export interface CreditStampLotOptions {
    userId:string;
    source:'purchase'|'grant'|'gift_received';
    count:number;
    priceCents?:number|null;
    autumnCheckoutId?:string;
    giftedByUserId?:string;
    transactionReason?:StampTransactionReason;
}

export interface CreditStampLotResult {
    lotId:string;
    balanceAfter:number;
}

export interface CreditGiftStampLotOptions {
    senderUserId:string;
    recipientUserId:string;
    count:number;
    priceCents:number;
    autumnCheckoutId:string;
}

export interface CreditGiftStampLotResult {
    lotId:string;
    recipientBalanceAfter:number;
    senderBalanceAfter:number;
}

export interface CreatePendingGiftOptions {
    senderUserId:string;
    recipientEmail:string;
    packId:string;
    count:number;
    priceCents:number;
    autumnCheckoutId:string;
}

export interface PendingGiftSummary {
    id:string;
    recipient_email:string;
    pack_id:string;
    count:number;
    price_cents:number;
    status:'pending'|'claimed'|'refunded';
    created_at:string;
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

export interface AutumnRefundRequest {
    checkoutId:string;
    amountCents:number;
}

export interface RefundPurchasedStampLotOptions {
    userId:string;
    lotId:string;
    issueRefund:(request:AutumnRefundRequest) => Promise<void>;
}

export interface RefundPurchasedStampLotResult {
    lotId:string;
    refundCents:number;
    balanceAfter:number;
}

export interface StampLotRefundRow {
    source:'purchase'|'grant'|'gift_received';
    original_count:number|string;
    remaining_count:number|string;
    price_paid_cents:number|string|null;
}

export interface StampLotSummary {
    id:string;
    source:'purchase'|'grant'|'gift_received';
    original_count:number;
    remaining_count:number;
    refund_cents:number;
    created_at:string;
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

interface RefundableStampLotRow extends StampLotRefundRow {
    id:string;
    autumn_checkout_id:string|null;
}

interface StampLotListRow extends StampLotRefundRow {
    id:string;
    created_at:string|Date;
}

interface PendingGiftRow {
    id:string;
    recipient_email:string;
    pack_id:string;
    count:number|string;
    price_cents:number|string;
    status:'pending'|'claimed'|'refunded';
    created_at:string|Date;
}

export class InsufficientStampsError extends Error {
    constructor () {
        super('Insufficient stamps.')
        this.name = 'InsufficientStampsError'
    }
}

export class StampLotNotFoundError extends Error {
    constructor () {
        super('Stamp lot not found.')
        this.name = 'StampLotNotFoundError'
    }
}

export class StampLotNotRefundableError extends Error {
    constructor () {
        super('Stamp lot is not refundable.')
        this.name = 'StampLotNotRefundableError'
    }
}

export function calculateStampLotRefundCents (
    lot:StampLotRefundRow
):number {
    if (lot.source !== 'purchase') return 0

    const originalCount = Number(lot.original_count)
    const remainingCount = Number(lot.remaining_count)
    const pricePaidCents = Number(lot.price_paid_cents)

    if (!Number.isFinite(originalCount) || originalCount <= 0) return 0
    if (!Number.isFinite(remainingCount) || remainingCount <= 0) return 0
    if (!Number.isFinite(pricePaidCents) || pricePaidCents <= 0) return 0

    return Math.floor((remainingCount * pricePaidCents) / originalCount)
}

export async function listStampLotsForUser (
    userId:string
):Promise<StampLotSummary[]> {
    const db = getDatabase()
    const result = await db.pool.query<StampLotListRow>(`
        SELECT
            id,
            source,
            original_count,
            remaining_count,
            price_paid_cents,
            created_at
        FROM stamp_lots
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [userId])

    return result.rows.map((lot) => {
        return {
            id: lot.id,
            source: lot.source,
            original_count: Number(lot.original_count),
            remaining_count: Number(lot.remaining_count),
            refund_cents: calculateStampLotRefundCents(lot),
            created_at: dateString(lot.created_at)
        }
    })
}

export async function listPendingGiftsForSender (
    userId:string
):Promise<PendingGiftSummary[]> {
    const db = getDatabase()
    const result = await db.pool.query<PendingGiftRow>(`
        SELECT
            id,
            recipient_email,
            pack_id,
            count,
            price_cents,
            status,
            created_at
        FROM pending_gifts
        WHERE sender_user_id = $1
        ORDER BY created_at DESC
    `, [userId])

    return result.rows.map((gift) => {
        return {
            id: gift.id,
            recipient_email: gift.recipient_email,
            pack_id: gift.pack_id,
            count: Number(gift.count),
            price_cents: Number(gift.price_cents),
            status: gift.status,
            created_at: dateString(gift.created_at)
        }
    })
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
            options.transactionReason ?? options.source,
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

export async function createPendingGift (
    options:CreatePendingGiftOptions
):Promise<PendingGiftSummary> {
    const db = getDatabase()
    const result = await db.pool.query<PendingGiftRow>(`
        INSERT INTO pending_gifts (
            sender_user_id,
            recipient_email,
            pack_id,
            count,
            price_cents,
            autumn_checkout_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
            id,
            recipient_email,
            pack_id,
            count,
            price_cents,
            status,
            created_at
    `, [
        options.senderUserId,
        options.recipientEmail,
        options.packId,
        options.count,
        options.priceCents,
        options.autumnCheckoutId
    ])
    const gift = result.rows[0]

    return {
        id: gift.id,
        recipient_email: gift.recipient_email,
        pack_id: gift.pack_id,
        count: Number(gift.count),
        price_cents: Number(gift.price_cents),
        status: gift.status,
        created_at: dateString(gift.created_at)
    }
}

export async function creditGiftStampLot (
    options:CreditGiftStampLotOptions
):Promise<CreditGiftStampLotResult> {
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
            options.recipientUserId,
            'gift_received',
            options.count,
            options.priceCents,
            options.autumnCheckoutId,
            options.senderUserId
        ])
        const lotId = lotResult.rows[0].id

        const recipientBalance = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance + $1
            WHERE id = $2
            RETURNING stamps_balance
        `, [options.count, options.recipientUserId])
        const recipientBalanceAfter = Number(
            recipientBalance.rows[0].stamps_balance
        )

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
            options.recipientUserId,
            lotId,
            options.count,
            'gift_received',
            options.autumnCheckoutId,
            recipientBalanceAfter
        ])

        const senderBalance = await client.query<BalanceRow>(`
            SELECT stamps_balance
            FROM users
            WHERE id = $1
        `, [options.senderUserId])
        const senderBalanceAfter = Number(
            senderBalance.rows[0].stamps_balance
        )

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
            options.senderUserId,
            null,
            0,
            'gift_sent',
            options.autumnCheckoutId,
            senderBalanceAfter
        ])

        await client.query('COMMIT')

        return {
            lotId,
            recipientBalanceAfter,
            senderBalanceAfter
        }
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

export async function refundPurchasedStampLot (
    options:RefundPurchasedStampLotOptions
):Promise<RefundPurchasedStampLotResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        const lotResult = await client.query<RefundableStampLotRow>(`
            SELECT
                id,
                source,
                original_count,
                remaining_count,
                price_paid_cents,
                autumn_checkout_id
            FROM stamp_lots
            WHERE id = $1
                AND user_id = $2
            FOR UPDATE
        `, [options.lotId, options.userId])
        const lot = lotResult.rows[0]

        if (!lot) throw new StampLotNotFoundError()

        const remainingCount = Number(lot.remaining_count)
        const refundCents = calculateStampLotRefundCents(lot)

        if (
            lot.source !== 'purchase' ||
            remainingCount <= 0 ||
            refundCents <= 0 ||
            !lot.autumn_checkout_id
        ) {
            throw new StampLotNotRefundableError()
        }

        await client.query(`
            UPDATE stamp_lots
            SET remaining_count = 0
            WHERE id = $1
                AND user_id = $2
        `, [options.lotId, options.userId])

        const balanceResult = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance - $1
            WHERE id = $2
                AND stamps_balance >= $1
            RETURNING stamps_balance
        `, [remainingCount, options.userId])

        if (!balanceResult.rows[0]) {
            throw new StampLotNotRefundableError()
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
            options.lotId,
            -remainingCount,
            'refund',
            lot.autumn_checkout_id,
            balanceAfter
        ])

        await options.issueRefund({
            checkoutId: lot.autumn_checkout_id,
            amountCents: refundCents
        })

        await client.query('COMMIT')

        return {
            lotId: options.lotId,
            refundCents,
            balanceAfter
        }
    } catch (error) {
        await client.query('ROLLBACK')

        throw error
    } finally {
        client.release()
    }
}

function dateString (value:string|Date):string {
    if (value instanceof Date) return value.toISOString()

    return value
}
