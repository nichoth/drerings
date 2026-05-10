export const TEXT_INPUT_MAX = 300

const graphemeSegmenter = (
    typeof Intl !== 'undefined' &&
    'Segmenter' in Intl
) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

export function countGraphemes (value:string):number {
    if (!value) return 0
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(value)).length
    }
    return Array.from(value).length
}
