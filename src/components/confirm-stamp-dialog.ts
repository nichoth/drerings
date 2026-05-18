import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { Button } from './button'
import './confirm-stamp-dialog.css'

export interface ConfirmStampDialogProps {
    stampsBalance:number;
    isSpinning:boolean;
    onConfirm:() => void;
    onCancel:() => void;
}

export const ConfirmStampDialog:FunctionComponent<
    ConfirmStampDialogProps
> = function ConfirmStampDialog (props) {
    return html`<div
        class="confirm-stamp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-stamp-dialog-title"
    >
        <div class="confirm-stamp-dialog-backdrop"
             onClick=${props.isSpinning ? undefined : props.onCancel}></div>
        <div class="confirm-stamp-dialog-panel">
            <h3 id="confirm-stamp-dialog-title">Use 1 stamp to share?</h3>
            <p>
                You've already used your free share this month. This
                share will cost 1 stamp.
            </p>
            <p>You have ${props.stampsBalance} stamps.</p>
            <div class="confirm-stamp-dialog-actions">
                <${Button}
                    type="button"
                    onClick=${props.onCancel}
                    disabled=${props.isSpinning}
                >
                    Cancel
                <//>
                <${Button}
                    type="button"
                    onClick=${props.onConfirm}
                    isSpinning=${props.isSpinning}
                >
                    Use 1 stamp
                <//>
            </div>
        </div>
    </div>`
}
