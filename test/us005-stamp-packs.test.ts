import { describe, expect, it } from 'vitest'
import * as billing from '../netlify/lib/billing'

describe('US-005 Autumn stamp pack configuration', () => {
    it('exports the configured Autumn stamp pack definitions', () => {
        const packDefinitions = (
            billing as typeof billing & {
                PACK_DEFINITIONS?:unknown;
            }
        ).PACK_DEFINITIONS

        expect(packDefinitions).toEqual({
            '10_stamps': {
                productId: '10_stamps',
                name: '10 stamps',
                count: 10,
                priceCents: 500,
                metadata: {
                    stamp_count: '10',
                    per_stamp_price_cents: '50'
                }
            },
            '25_stamps': {
                productId: '25_stamps',
                name: '25 stamps',
                count: 25,
                priceCents: 1000,
                metadata: {
                    stamp_count: '25',
                    per_stamp_price_cents: '40'
                }
            }
        })
    })
})
