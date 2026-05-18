import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'

export interface NoStampsMessageProps {
    message?:string;
}

export const NoStampsMessage:FunctionComponent<
    NoStampsMessageProps
> = function NoStampsMessage ({ message }) {
    const text = message || 'You\'re out of stamps for sharing this month.'

    return html`<p class="no-stamps-message" role="alert">
        ${text}
        ${' '}
        <a href="/pricing">Buy more on the pricing page</a>.
    </p>`
}
