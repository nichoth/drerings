export interface MagicLinkEmail {
    email:string;
    loginUrl:string;
}

export interface StampGiftEmail {
    email:string;
    senderEmail:string;
    count:number;
}

export interface PendingGiftInviteEmail extends StampGiftEmail {
    signupUrl:string;
}

export interface PendingGiftRefundEmail {
    email:string;
    recipientEmail:string;
}

export type PostcardEmail = {
    to:string;
    senderHandle:string|null;
    text:string;
    pngBase64:string;
    postcardId:string;
}

export async function sendMagicLinkEmail ({
    email,
    loginUrl
}:MagicLinkEmail):Promise<void> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is required')
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ||
                'Drerings <login@drerings.app>',
            to: email,
            subject: 'Sign in to Drerings',
            html: `<p>Use this link to sign in to Drerings:</p>
                <p><a href="${loginUrl}">Sign in to Drerings</a></p>`,
            text: `Use this link to sign in to Drerings:\n\n${loginUrl}`
        })
    })

    if (!response.ok) {
        throw new Error(`Resend email failed with ${response.status}`)
    }
}

export async function sendStampGiftEmail ({
    email,
    senderEmail,
    count
}:StampGiftEmail):Promise<void> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is required')
    }

    const senderName = senderEmail.split('@')[0] || senderEmail
    const message = `${senderName} sent you ${count} stamps.`
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ||
                'Drerings <login@drerings.app>',
            to: email,
            subject: 'You received Drerings stamps',
            html: `<p>${message}</p>`,
            text: message
        })
    })

    if (!response.ok) {
        throw new Error(`Resend email failed with ${response.status}`)
    }
}

export async function sendPendingGiftInviteEmail ({
    email,
    senderEmail,
    count,
    signupUrl
}:PendingGiftInviteEmail):Promise<void> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is required')
    }

    const senderName = senderEmail.split('@')[0] || senderEmail
    const message = [
        `${senderName} sent you ${count} Drerings stamps.`,
        'Create an account to claim them:',
        signupUrl
    ].join('\n\n')
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ||
                'Drerings <login@drerings.app>',
            to: email,
            subject: 'Claim your Drerings stamps',
            html: `<p>${senderName} sent you ${count} Drerings stamps.</p>
                <p><a href="${signupUrl}">Create an account to claim them</a>
                </p>`,
            text: message
        })
    })

    if (!response.ok) {
        throw new Error(`Resend email failed with ${response.status}`)
    }
}

export async function sendPendingGiftRefundEmail ({
    email,
    recipientEmail
}:PendingGiftRefundEmail):Promise<void> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is required')
    }

    const message = [
        `Your gift to ${recipientEmail} was refunded.`,
        "They didn't claim it within 90 days."
    ].join('\n\n')
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ||
                'Drerings <login@drerings.app>',
            to: email,
            subject: 'Your Drerings gift was refunded',
            html: `<p>Your gift to ${recipientEmail} was refunded.</p>
                <p>They didn't claim it within 90 days.</p>`,
            text: message
        })
    })

    if (!response.ok) {
        throw new Error(`Resend email failed with ${response.status}`)
    }
}

function escapeHtml (str:string):string {
    return String(str).replace(/[<>&"]/g, c => {
        switch (c) {
            case '<': return '&lt;'
            case '>': return '&gt;'
            case '&': return '&amp;'
            case '"': return '&quot;'
            default: return c
        }
    })
}

export async function sendPostcardEmail (
    options:PostcardEmail
):Promise<string> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is required')
    }

    const displayName = options.senderHandle ?
        options.senderHandle.split('@')[0] :
        'Someone'
    const subject = `${displayName} sent you a Drerings postcard`
    const escapedText = escapeHtml(options.text)
    const html = `<p>${escapedText}</p>`

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ||
                'Drerings <login@drerings.app>',
            to: options.to,
            subject,
            html,
            text: options.text,
            attachments: [{
                filename: 'postcard.png',
                content: options.pngBase64
            }],
            headers: {
                'X-Entity-Ref-ID': options.postcardId
            }
        })
    })

    if (!response.ok) {
        throw new Error(`Resend email failed with ${response.status}`)
    }

    const body = await response.json() as {id?:string}

    if (!body.id || typeof body.id !== 'string') {
        throw new Error('Resend response missing email id')
    }

    return body.id
}
