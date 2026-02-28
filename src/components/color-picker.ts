import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useMemo } from 'preact/hooks'
import './color-picker.css'

const SWATCHES = [
    '#000000',
    '#ffffff',
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899'
]

export interface ColorPickerProps {
    id?:string;
    label?:string;
    value:string;
    disabled?:boolean;
    onChange:(nextColor:string)=>void;
}

export const ColorPicker:FunctionComponent<ColorPickerProps> = function (
    props
) {
    const id = props.id || useMemo(() => {
        return `color-picker-${Math.random().toString(36).slice(2, 10)}`
    }, [])
    const label = props.label || 'Brush color'

    return html`<div class="color-picker-field">
        <label for=${id}>${label}</label>

        <div class="color-picker-controls">
            <input
                id=${id}
                class="color-input"
                type="color"
                value=${props.value}
                disabled=${props.disabled}
                onInput=${(ev:Event) => {
                    const target = ev.currentTarget as HTMLInputElement
                    props.onChange(target.value)
                }}
                aria-label=${label}
            />

            <div class="color-swatches" role="list" aria-label="Preset colors">
                ${SWATCHES.map((color) => html`
                    <button
                        type="button"
                        class=${[
                            'swatch',
                            props.value === color ? 'active' : ''
                        ].filter(Boolean).join(' ')}
                        style=${`--swatch-color:${color}`}
                        disabled=${props.disabled}
                        aria-label=${`Set color ${color}`}
                        onClick=${() => {
                            props.onChange(color)
                        }}
                    ></button>
                `)}
            </div>
        </div>
    </div>`
}
