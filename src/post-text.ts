import type { AppBskyRichtextFacet } from '@atproto/api'

export const BSKY_POST_TEXT_MAX = 300
export const POST_FOOTER_TEXT = 'posted with drerings.app'
export const POST_FOOTER_URL = 'https://drerings.app/'
export const POST_FOOTER_PREFIX = '\n\n'
export const POST_FOOTER_SUFFIX = `${POST_FOOTER_PREFIX}${POST_FOOTER_TEXT}`

const graphemeSegmenter = (
    typeof Intl !== 'undefined' &&
    'Segmenter' in Intl
) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

const utf8Encoder = new TextEncoder()

export function countGraphemes (value:string):number {
    if (!value) return 0
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(value)).length
    }
    return Array.from(value).length
}

export const POST_FOOTER_GRAPHEME_LENGTH = countGraphemes(POST_FOOTER_SUFFIX)
export const POST_TEXT_INPUT_MAX = BSKY_POST_TEXT_MAX - POST_FOOTER_GRAPHEME_LENGTH

export function appendPostFooter (text:string):string {
    return `${text}${POST_FOOTER_SUFFIX}`
}

export function createPostFooterFacet (
    text:string
):AppBskyRichtextFacet.Main {
    if (!text.endsWith(POST_FOOTER_SUFFIX)) {
        throw new Error('Footer link text is missing from post body')
    }

    const footerTextStart = text.length - POST_FOOTER_TEXT.length
    const byteStart = utf8Encoder.encode(text.slice(0, footerTextStart)).length
    const byteEnd = byteStart + utf8Encoder.encode(POST_FOOTER_TEXT).length

    return {
        index: { byteStart, byteEnd },
        features: [{
            $type: 'app.bsky.richtext.facet#link',
            uri: POST_FOOTER_URL
        }]
    }
}
