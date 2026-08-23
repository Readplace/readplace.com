/* DeepSeek's tokenisation is not uniform per character. Their token guide gives
 * roughly 0.3 tokens per English character and 0.6 per Chinese character, so a
 * budget sized on a single characters-per-token constant is only ever right for
 * one script. Sizing it for English and then feeding it CJK or Arabic caps the
 * response ~17% short and the model stops mid-page.
 * https://api-docs.deepseek.com/quick_start/token_usage */
const TOKENS_PER_ASCII_CHAR = 0.3;
const TOKENS_PER_NON_ASCII_CHAR = 0.6;

/* Floor for very short pages, where the per-character estimate underestimates
 * the fixed cost of any well-formed response. */
const MIN_OUTPUT_TOKENS = 256;

/**
 * Estimate the output-token budget a page needs, weighting non-ASCII characters
 * at DeepSeek's higher rate.
 *
 * `headroom` multiplies the estimate. A stage that reproduces its input roughly
 * one-for-one needs a small multiple; a stage that wraps the input in markup
 * emits more tokens than the text alone implies and needs a larger one.
 */
export function estimateOutputTokens(params: { text: string; headroom: number }): number {
	/* Iterate code points, not UTF-16 units, so an astral character counts once.
	 * `charCodeAt(0)` on a non-empty code point yields its first unit, and for
	 * anything astral that is a surrogate, which is already above the ASCII cut. */
	const characters = [...params.text];
	const nonAscii = characters.filter((character) => character.charCodeAt(0) > 0x7f).length;
	const ascii = characters.length - nonAscii;
	const base = ascii * TOKENS_PER_ASCII_CHAR + nonAscii * TOKENS_PER_NON_ASCII_CHAR;
	return Math.max(MIN_OUTPUT_TOKENS, Math.ceil(base * params.headroom));
}
