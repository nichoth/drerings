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
            stamps_starter: {
                productId: 'stamps_starter',
                name: 'Starter',
                count: 10,
                priceCents: 500,
                metadata: {
                    stamp_count: '10',
                    per_stamp_price_cents: '50'
                }
            },
            stamps_bundle: {
                productId: 'stamps_bundle',
                name: 'Bundle',
                count: 25,
                priceCents: 1000,
                metadata: {
                    stamp_count: '25',
                    per_stamp_price_cents: '40'
                }
            },
            stamps_big_bundle: {
                productId: 'stamps_big_bundle',
                name: 'Big bundle',
                count: 60,
                priceCents: 2000,
                metadata: {
                    stamp_count: '60',
                    per_stamp_price_cents: '33.33'
                }
            }
        })
    })
})
