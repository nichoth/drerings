import { getDatabase } from '@netlify/database'

type StampTransactionReason =
    'purchase'|
    'grant'|
    'migration_grant'|
    'gift_sent'|
    'gift_received'|
    'gift_reclaimed'

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

export type SentGiftStatus = 'unused'|'in_use'|'expired'|'refunded'

export interface SentGiftSummary {
    id:string;
    recipient_email:string;
    original_count:number;
    remaining_count:number;
    refund_cents:number;
    refundable:boolean;
    refundable_until:string;
    status:SentGiftStatus;
    created_at:string;
}

export interface PendingGiftRefundEmailOptions {
    email:string;
    recipientEmail:string;
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

export interface RefundExpiredPendingGiftsOptions {
    issueRefund:(request:AutumnRefundRequest) => Promise<void>;
    sendRefundEmail:(options:PendingGiftRefundEmailOptions) => Promise<void>;
}

export interface RefundExpiredPendingGiftsResult {
    processed:number;
    refunded:number;
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

export interface RefundSentGiftStampLotOptions {
    senderUserId:string;
    lotId:string;
    issueRefund:(request:AutumnRefundRequest) => Promise<void>;
    now?:Date;
}

export interface RefundSentGiftStampLotResult {
    lotId:string;
    refundCents:number;
    recipientBalanceAfter:number;
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

interface SentGiftRow {
    id:string;
    recipient_email:string;
    original_count:number|string;
    remaining_count:number|string;
    price_paid_cents:number|string|null;
    created_at:string|Date;
}

interface RefundableSentGiftRow extends SentGiftRow {
    user_id:string;
    autumn_checkout_id:string|null;
}

interface ExpiredPendingGiftRow {
    id:string;
    sender_email:string;
    recipient_email:string;
    autumn_checkout_id:string;
    price_cents:number|string;
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

export async function listSentGiftsForSender (
    userId:string,
    now:Date = new Date()
):Promise<SentGiftSummary[]> {
    const db = getDatabase()
    const result = await db.pool.query<SentGiftRow>(`
        SELECT
            stamp_lots.id,
            users.email AS recipient_email,
            stamp_lots.original_count,
            stamp_lots.remaining_count,
            stamp_lots.price_paid_cents,
            stamp_lots.created_at
        FROM stamp_lots
        JOIN users
            ON users.id = stamp_lots.user_id
        WHERE stamp_lots.gifted_by_user_id = $1
            AND stamp_lots.source = 'gift_received'
        ORDER BY stamp_lots.created_at DESC
    `, [userId])

    return result.rows.map((gift) => {
        return sentGiftSummary(gift, now)
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

export async function refundSentGiftStampLot (
    options:RefundSentGiftStampLotOptions
):Promise<RefundSentGiftStampLotResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        const lotResult = await client.query<RefundableSentGiftRow>(`
            SELECT
                stamp_lots.id,
                stamp_lots.user_id,
                users.email AS recipient_email,
                stamp_lots.original_count,
                stamp_lots.remaining_count,
                stamp_lots.price_paid_cents,
                stamp_lots.autumn_checkout_id,
                stamp_lots.created_at
            FROM stamp_lots
            JOIN users
                ON users.id = stamp_lots.user_id
            WHERE stamp_lots.id = $1
                AND stamp_lots.gifted_by_user_id = $2
                AND stamp_lots.source = 'gift_received'
            FOR UPDATE
        `, [options.lotId, options.senderUserId])
        const lot = lotResult.rows[0]

        if (!lot) throw new StampLotNotFoundError()

        const gift = sentGiftSummary(lot, options.now ?? new Date())

        if (
            !gift.refundable ||
            !lot.autumn_checkout_id
        ) {
            throw new StampLotNotRefundableError()
        }

        await client.query(`
            UPDATE stamp_lots
            SET remaining_count = 0
            WHERE id = $1
                AND user_id = $2
        `, [options.lotId, lot.user_id])

        const balanceResult = await client.query<BalanceRow>(`
            UPDATE users
            SET stamps_balance = stamps_balance - $1
            WHERE id = $2
                AND stamps_balance >= $1
            RETURNING stamps_balance
        `, [gift.remaining_count, lot.user_id])

        if (!balanceResult.rows[0]) {
            throw new StampLotNotRefundableError()
        }

        const recipientBalanceAfter = Number(
            balanceResult.rows[0].stamps_balance
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
            lot.user_id,
            options.lotId,
            -gift.remaining_count,
            'gift_reclaimed',
            lot.autumn_checkout_id,
            recipientBalanceAfter
        ])

        await options.issueRefund({
            checkoutId: lot.autumn_checkout_id,
            amountCents: gift.refund_cents
        })

        await client.query('COMMIT')

        return {
            lotId: options.lotId,
            refundCents: gift.refund_cents,
            recipientBalanceAfter
        }
    } catch (error) {
        await client.query('ROLLBACK')

        throw error
    } finally {
        client.release()
    }
}

export async function refundExpiredPendingGifts (
    options:RefundExpiredPendingGiftsOptions
):Promise<RefundExpiredPendingGiftsResult> {
    const db = getDatabase()
    const result = await db.pool.query<ExpiredPendingGiftRow>(`
        SELECT
            pending_gifts.id,
            users.email AS sender_email,
            pending_gifts.recipient_email,
            pending_gifts.autumn_checkout_id,
            pending_gifts.price_cents
        FROM pending_gifts
        JOIN users
            ON users.id = pending_gifts.sender_user_id
        WHERE pending_gifts.status = 'pending'
            AND pending_gifts.created_at < now() - interval '90 days'
        ORDER BY pending_gifts.created_at ASC
    `, [])

    let refunded = 0

    for (const gift of result.rows) {
        const didRefund = await refundExpiredPendingGift(gift, options)

        if (didRefund) refunded += 1
    }

    return {
        processed: result.rows.length,
        refunded
    }
}

async function refundExpiredPendingGift (
    gift:ExpiredPendingGiftRow,
    options:RefundExpiredPendingGiftsOptions
):Promise<boolean> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient
    let committed = false

    try {
        await client.query('BEGIN')

        const locked = await client.query<ExpiredPendingGiftRow>(`
            SELECT
                pending_gifts.id,
                users.email AS sender_email,
                pending_gifts.recipient_email,
                pending_gifts.autumn_checkout_id,
                pending_gifts.price_cents
            FROM pending_gifts
            JOIN users
                ON users.id = pending_gifts.sender_user_id
            WHERE pending_gifts.id = $1
                AND pending_gifts.status = 'pending'
                AND pending_gifts.created_at < now() - interval '90 days'
            FOR UPDATE SKIP LOCKED
        `, [gift.id])
        const lockedGift = locked.rows[0]

        if (!lockedGift) {
            await client.query('ROLLBACK')

            return false
        }

        await options.issueRefund({
            checkoutId: lockedGift.autumn_checkout_id,
            amountCents: Number(lockedGift.price_cents)
        })

        const updated = await client.query(`
            UPDATE pending_gifts
            SET status = 'refunded'
            WHERE id = $1
                AND status = 'pending'
            RETURNING id
        `, [lockedGift.id])

        if (!updated.rows[0]) {
            await client.query('ROLLBACK')

            return false
        }

        await client.query('COMMIT')
        committed = true

        await sendPendingGiftRefundNotice(lockedGift, options)

        return true
    } catch (error) {
        if (!committed) await client.query('ROLLBACK')

        console.error('Expired pending gift refund failed.', error)

        return false
    } finally {
        client.release()
    }
}

async function sendPendingGiftRefundNotice (
    gift:ExpiredPendingGiftRow,
    options:RefundExpiredPendingGiftsOptions
):Promise<void> {
    try {
        await options.sendRefundEmail({
            email: gift.sender_email,
            recipientEmail: gift.recipient_email
        })
    } catch (error) {
        console.error('Pending gift refund email failed.', error)
    }
}

function sentGiftSummary (
    gift:SentGiftRow,
    now:Date
):SentGiftSummary {
    const originalCount = Number(gift.original_count)
    const remainingCount = Number(gift.remaining_count)
    const pricePaidCents = Number(gift.price_paid_cents)
    const createdAt = new Date(gift.created_at)
    const refundableUntil = addUtcDays(createdAt, 30)
    const hasFullLot = remainingCount === originalCount && remainingCount > 0
    const isInWindow = now.getTime() <= refundableUntil.getTime()
    const isPriceRefundable = Number.isFinite(pricePaidCents) &&
        pricePaidCents > 0
    const refundable = hasFullLot && isInWindow && isPriceRefundable

    return {
        id: gift.id,
        recipient_email: gift.recipient_email,
        original_count: originalCount,
        remaining_count: remainingCount,
        refund_cents: refundable ? pricePaidCents : 0,
        refundable,
        refundable_until: refundableUntil.toISOString(),
        status: sentGiftStatus(hasFullLot, isInWindow),
        created_at: dateString(gift.created_at)
    }
}

function sentGiftStatus (
    hasFullLot:boolean,
    isInWindow:boolean
):SentGiftStatus {
    if (!hasFullLot) return 'in_use'
    if (!isInWindow) return 'expired'

    return 'unused'
}

function addUtcDays (date:Date, days:number):Date {
    const copy = new Date(date)

    copy.setUTCDate(copy.getUTCDate() + days)

    return copy
}

function dateString (value:string|Date):string {
    if (value instanceof Date) return value.toISOString()

    return value
}
