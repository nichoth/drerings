export interface StampPackDefinition {
    productId:string;
    name:string;
    count:number;
    priceCents:number;
    metadata:{
        stamp_count:string;
        per_stamp_price_cents:string;
    };
}

export const PACK_DEFINITIONS = {
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
} as const satisfies Record<string, StampPackDefinition>

export type StampPackProductId = keyof typeof PACK_DEFINITIONS

export const STAMP_PACKS:StampPackDefinition[] = Object.values(
    PACK_DEFINITIONS
)

export function formatPackPrice (priceCents:number):string {
    return `$${(priceCents / 100).toFixed(2)}`
}

export function formatPerStampPrice (
    pack:StampPackDefinition
):string {
    return `${pack.metadata.per_stamp_price_cents}c each`
}
