import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import './input.css'

export const Input:FunctionComponent<{
    type?:string
    label:string
    id?:string
    class?:string
}> = function (props) {
    const className = ([
        props.class,
        'input'
    ]).filter(Boolean).join(' ')

    return html`<div class="input">
        <label for=${props.id}>${props.label}</label>
        <input
            ...${props}
            class=${className}
            type=${props.type}
            id=${props.id}
            name=${props.id}
        />
    </div>`
}
