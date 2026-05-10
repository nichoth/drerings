import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON
} from '@simplewebauthn/server'
import type { SessionUser } from './auth-store.js'
import { getSessionSecret } from './session.js'

type PasskeyPurpose = 'registration'|'authentication'

interface ChallengeTokenPayload {
    challenge:string;
    expires_at:string;
    origin:string;
    purpose:PasskeyPurpose;
    userId?:string;
}

export interface StoredPasskey {
    id:string;
    userId:string;
    credentialId:string;
    publicKey:Uint8Array;
    counter:number;
    user:SessionUser;
}

export interface PasskeyOptions<TOptions> {
    options:TOptions;
    challengeToken:string;
}

export interface SavePasskeyInput {
    userId:string;
    credentialId:string;
    publicKey:Uint8Array;
    counter:number;
}

interface PasskeyRow {
    id:string;
    user_id:string;
    credential_id:string;
    public_key:string;
    counter:number;
    email:string;
    subscription_status:SessionUser['subscription_status'];
}

export function createPasskeyChallengeToken (
    input:Omit<ChallengeTokenPayload, 'expires_at'>
):string {
    const payload = Buffer.from(JSON.stringify({
        ...input,
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString()
    })).toString('base64url')
    const signature = crypto
        .createHmac('sha256', getSessionSecret())
        .update(payload)
        .digest('base64url')

    return `${payload}.${signature}`
}

export function verifyPasskeyChallengeToken (
    token:string,
    purpose:PasskeyPurpose
):ChallengeTokenPayload|null {
    const [payload, signature] = token.split('.')

    if (!payload || !signature) return null

    const expected = crypto
        .createHmac('sha256', getSessionSecret())
        .update(payload)
        .digest('base64url')

    if (!isEqualSignature(signature, expected)) return null

    try {
        const body = JSON.parse(
            Buffer.from(payload, 'base64url').toString('utf8')
        ) as ChallengeTokenPayload

        if (body.purpose !== purpose) return null
        if (new Date(body.expires_at).getTime() <= Date.now()) return null

        return body
    } catch {
        return null
    }
}

export async function generatePasskeyRegistrationOptions (
    user:SessionUser,
    origin:string
):Promise<PasskeyOptions<PublicKeyCredentialCreationOptionsJSON>> {
    const rpID = getRpId(origin)
    const passkeys = await listPasskeysForUser(user.id)
    const options = await generateRegistrationOptions({
        rpName: 'Drerings',
        rpID,
        userName: user.email,
        userID: Buffer.from(user.id),
        userDisplayName: user.email,
        attestationType: 'none',
        excludeCredentials: passkeys.map(passkey => ({
            id: passkey.credentialId
        })),
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred'
        }
    })

    return {
        options,
        challengeToken: createPasskeyChallengeToken({
            challenge: options.challenge,
            origin,
            purpose: 'registration',
            userId: user.id
        })
    }
}

export async function verifyPasskeyRegistration ({
    user,
    origin,
    challengeToken,
    response
}:{
    user:SessionUser;
    origin:string;
    challengeToken:string;
    response:RegistrationResponseJSON;
}):Promise<boolean> {
    const challenge = verifyPasskeyChallengeToken(
        challengeToken,
        'registration'
    )

    if (!challenge || challenge.userId !== user.id) return false
    if (challenge.origin !== origin) return false

    const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: getRpId(origin)
    })

    if (!verification.verified) return false

    await savePasskey({
        userId: user.id,
        credentialId: verification.registrationInfo.credential.id,
        publicKey: verification.registrationInfo.credential.publicKey,
        counter: verification.registrationInfo.credential.counter
    })

    return true
}

export async function generatePasskeyLoginOptions (
    origin:string
):Promise<PasskeyOptions<PublicKeyCredentialRequestOptionsJSON>> {
    const options = await generateAuthenticationOptions({
        rpID: getRpId(origin),
        userVerification: 'preferred'
    })

    return {
        options,
        challengeToken: createPasskeyChallengeToken({
            challenge: options.challenge,
            origin,
            purpose: 'authentication'
        })
    }
}

export async function verifyPasskeyLogin ({
    origin,
    challengeToken,
    response
}:{
    origin:string;
    challengeToken:string;
    response:AuthenticationResponseJSON;
}):Promise<SessionUser|null> {
    const challenge = verifyPasskeyChallengeToken(
        challengeToken,
        'authentication'
    )

    if (!challenge || challenge.origin !== origin) return null

    const passkey = await findPasskeyByCredentialId(response.id)

    if (!passkey) return null

    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: getRpId(origin),
        credential: {
            id: passkey.credentialId,
            publicKey: passkey.publicKey,
            counter: passkey.counter
        }
    })

    if (!verification.verified) return null

    await updatePasskeyCounter(
        passkey.credentialId,
        verification.authenticationInfo.newCounter
    )

    return passkey.user
}

export async function savePasskey (
    input:SavePasskeyInput
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        INSERT INTO passkeys (
            user_id,
            credential_id,
            public_key,
            counter
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (credential_id) DO UPDATE SET
            public_key = EXCLUDED.public_key,
            counter = EXCLUDED.counter
    `, [
        input.userId,
        input.credentialId,
        Buffer.from(input.publicKey).toString('base64url'),
        input.counter
    ])
}

export async function findPasskeyByCredentialId (
    credentialId:string
):Promise<StoredPasskey|null> {
    const db = getDatabase()
    const result = await db.pool.query<PasskeyRow>(`
        SELECT
            passkeys.id,
            passkeys.user_id,
            passkeys.credential_id,
            passkeys.public_key,
            passkeys.counter,
            users.email,
            users.subscription_status
        FROM passkeys
        INNER JOIN users ON users.id = passkeys.user_id
        WHERE passkeys.credential_id = $1
    `, [credentialId])

    return result.rows[0] ? mapPasskeyRow(result.rows[0]) : null
}

async function listPasskeysForUser (
    userId:string
):Promise<StoredPasskey[]> {
    const db = getDatabase()
    const result = await db.pool.query<PasskeyRow>(`
        SELECT
            passkeys.id,
            passkeys.user_id,
            passkeys.credential_id,
            passkeys.public_key,
            passkeys.counter,
            users.email,
            users.subscription_status
        FROM passkeys
        INNER JOIN users ON users.id = passkeys.user_id
        WHERE passkeys.user_id = $1
    `, [userId])

    return result.rows.map(mapPasskeyRow)
}

async function updatePasskeyCounter (
    credentialId:string,
    counter:number
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        UPDATE passkeys
        SET counter = $2
        WHERE credential_id = $1
    `, [credentialId, counter])
}

function mapPasskeyRow (row:PasskeyRow):StoredPasskey {
    return {
        id: row.id,
        userId: row.user_id,
        credentialId: row.credential_id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
        counter: Number(row.counter),
        user: {
            id: row.user_id,
            email: row.email,
            subscription_status: row.subscription_status
        }
    }
}

function getRpId (origin:string):string {
    return new URL(origin).hostname
}

function isEqualSignature (left:string, right:string):boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)

    if (leftBuffer.length !== rightBuffer.length) return false

    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}
