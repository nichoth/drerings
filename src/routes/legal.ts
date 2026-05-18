import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect } from 'preact/hooks'
import { type AppState } from '../state'
import './legal.css'

const CONTACT_EMAIL = 'support@drerings.app'

export const PrivacyRoute:FunctionComponent<{
    state:AppState;
}> = function PrivacyRoute () {
    useLegalMeta(
        'Privacy Policy - Drerings',
        'Privacy details for Drerings accounts, drawings, payments, and data.'
    )

    return html`<div class="route legal">
        <article>
            <header class="legal-header">
                <p class="legal-kicker">Drerings</p>
                <h2>Privacy Policy</h2>
                <p>
                    This policy explains what Drerings collects, why it is
                    collected, and how account data can be deleted.
                </p>
            </header>

            <section>
                <h3>Data we collect</h3>
                <p>
                    We collect your email address to create your account, send
                    sign-in links, confirm account changes, and contact you
                    about account activity.
                </p>
                <p>
                    When you use paid features, we store your drawings, drawing
                    text, alt text, saved image files, public post records, and
                    timestamps so you can reopen work and share published URLs.
                </p>
                <p>
                    Payment metadata is handled through Autumn. Drerings stores
                    provider identifiers and subscription status, but does not
                    store card numbers or bank details.
                </p>
            </section>

            <section>
                <h3>How we use it</h3>
                <p>
                    Account data is used to authenticate you, protect paid
                    features, save drawings, publish public posts when you ask,
                    and keep subscription access in sync.
                </p>
            </section>

            <section>
                <h3>Retention and deletion</h3>
                <p>
                    Account records and private drawings are kept while your
                    account exists. Public posts stay online until the drawing
                    or account is deleted. Delete your account from the account
                    page to remove drawings, blobs, public posts, and account
                    records from Drerings.
                </p>
            </section>

            <section>
                <h3>Contact</h3>
                <p>
                    Questions or deletion requests can be sent to
                    ${' '}<a href=${`mailto:${CONTACT_EMAIL}`}>
                        ${CONTACT_EMAIL}
                    </a>.
                </p>
            </section>
        </article>
    </div>`
}

export const TermsRoute:FunctionComponent<{
    state:AppState;
}> = function TermsRoute () {
    useLegalMeta(
        'Terms of Service - Drerings',
        'Terms for using Drerings drawings, paid accounts, and published URLs.'
    )

    return html`<div class="route legal">
        <article>
            <header class="legal-header">
                <p class="legal-kicker">Drerings</p>
                <h2>Terms of Service</h2>
                <p>
                    These terms describe the rules for using Drerings and the
                    paid plan that unlocks saving and publishing.
                </p>
            </header>

            <section>
                <h3>Using Drerings</h3>
                <p>
                    You are responsible for the drawings, text, and alt text
                    you create. Do not upload unlawful content or publish work
                    that violates someone else's rights.
                </p>
            </section>

            <section>
                <h3>Paid accounts</h3>
                <p>
                    The paid plan lets you save drawings, reopen them, and
                    publish drawings to stable public URLs. Billing and
                    checkout are handled by Autumn, and subscription status is
                    used to decide whether paid features are available.
                </p>
            </section>

            <section>
                <h3>Cancellation and deletion</h3>
                <p>
                    You can also delete your account, which removes saved
                    drawings, blobs, public posts, and account records from
                    Drerings.
                </p>
            </section>

            <section>
                <h3>Contact</h3>
                <p>
                    Questions about these terms can be sent to
                    ${' '}<a href=${`mailto:${CONTACT_EMAIL}`}>
                        ${CONTACT_EMAIL}
                    </a>.
                </p>
            </section>
        </article>
    </div>`
}

function useLegalMeta (
    title:string,
    description:string
):void {
    useEffect(() => {
        document.title = title
        ensureMetaDescription().setAttribute('content', description)
    }, [title, description])
}

function ensureMetaDescription ():HTMLMetaElement {
    const existing = document.querySelector<HTMLMetaElement>(
        'meta[name="description"]'
    )

    if (existing) return existing

    const meta = document.createElement('meta')
    meta.setAttribute('name', 'description')
    document.head.append(meta)

    return meta
}
