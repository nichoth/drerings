import { type ComponentChildren, type FunctionComponent } from 'preact'
import { html } from 'htm/preact'
import { useCallback } from 'preact/hooks'
import { type Signal, useSignal } from '@preact/signals'
import './button.css'

interface ButtonProps {
    onClick?:(ev:MouseEvent)=>void|Promise<void>;
    isSpinning?:Signal<boolean>;
    class?:string;
    children?:ComponentChildren;
    disabled?:boolean|Signal<boolean>;
    type?:'button'|'submit'|'reset';
}

export const LinkBtn:FunctionComponent<{
    class?:string;
    href:string;
    disabled?:boolean;
    children?:ComponentChildren;
}> = function (props) {
    const { href, children, disabled } = props

    const classes = ['btn']
        .concat(props.class?.split(' ') || [])
        .filter(Boolean)

    return html`<a
        class="${classes}"
        href="${disabled ? undefined : href}"
        aria-disabled=${disabled || undefined}
    >
        ${children}
    </a>`
}

export const Button:FunctionComponent<ButtonProps> = function (props) {
    const {
        isSpinning: _isSpinning,
        onClick,
        class: className,
        children,
        disabled: _disabled,
        ..._props
    } = props
    const isSpinning = _isSpinning || useSignal<boolean>(false)
    const disabled = typeof _disabled === 'object' ?
        _disabled.value :
        _disabled

    const classes = (Array.from(new Set([
        'btn',
        className,
        isSpinning.value ? 'spinning' : ''
    ]))).filter(Boolean).join(' ').trim()

    const click = useCallback(async (ev:MouseEvent) => {
        if (typeof onClick === 'function') {
            isSpinning.value = true
            try {
                await onClick(ev)
            } finally {
                isSpinning.value = false
            }
        }
    }, [onClick])

    return html`<button
        ...${_props}
        onClick=${typeof onClick === 'function' ? click : undefined}
        disabled=${isSpinning.value || disabled}
        class=${classes}
    >
        <span class="btn-content">${children}</span>
    </button>`
}
