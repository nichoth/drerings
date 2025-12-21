import { html } from 'htm/preact'
import { useCallback } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import Debug from '@substrate-system/debug'
import { Button } from '../components/button'
import { Input } from '../components/input.js'
import { useSignal } from '@preact/signals'
import './contact.css'
const debug = Debug('example:view:contact')

export const ContactRoute:FunctionComponent = function ContactRoute () {
    const isResolving = useSignal<boolean>(false)

    const submit = useCallback(async (ev:SubmitEvent) => {
        ev.preventDefault()
        debug('submit', ev)
        isResolving.value = true
        await sleep(3000)
        isResolving.value = false
    }, [])

    return html`<div class="route contact">
        <h2>
            contact route
        </h2>

        <form class="contact" onSubmit=${submit}>
            <${Input}
                disabled=${isResolving.value}
                id="example"
                name="example"
                type="text"
                label="Input"
            />

            <div class="controls">
                <${Button}
                    isSpinning=${isResolving}
                    class="btn"
                    type="submit"
                >
                    Submit
                <//>
            </div>
        </form>
    </div>`
}

function sleep (ms:number):Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
