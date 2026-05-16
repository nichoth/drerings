import { type FunctionComponent } from 'preact'
import { html } from 'htm/preact'

export const IconStamp:FunctionComponent = function () {
    return html`<svg
        aria-hidden="true"
        class="icon-stamp"
        fill="none"
        viewBox="0 0 24 24"
        width="20"
        height="20"
    >
        <path
            d="M5 4h14v16H5V4Z"
            stroke="currentColor"
            stroke-linejoin="round"
            stroke-width="2"
        />
        <path
            d="M8 7h8v5H8V7ZM8 16h8"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
        />
    </svg>`
}
