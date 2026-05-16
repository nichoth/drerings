export interface MagicLinkEmail {
    email:string;
    loginUrl:string;
}

export interface StampGiftEmail {
    email:string;
    senderEmail:string;
    count:number;
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
