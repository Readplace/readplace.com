/**
 * Turn a stored article body (canonical HTML in S3 at content/{url}/content.html)
 * into clean prose suitable for narration, and report what it will cost to speak.
 *
 * This is a dependency-free approximation for the POC. In production, reuse the
 * existing readability extraction in @packages/article-parser rather than re-parsing
 * HTML with regexes — the point here is to demonstrate the shape and the numbers.
 */

import { audioMinutesForChars } from "./cost.ts";

export type Narration = {
	readonly text: string;
	readonly characters: number;
	readonly words: number;
	readonly estimatedAudioMinutes: number;
};

/**
 * Elements whose contents must never be spoken. The `(?:<\/\1>|$)` tail removes the
 * block even when its closing tag is missing — otherwise an unterminated <script>
 * would survive the tag strip below and its source would be read aloud.
 */
const REMOVABLE_BLOCK =
	/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi;
/** Block-level tags become line breaks so words don't run together. */
const BLOCK_TAG =
	/<\/?(p|div|section|article|header|footer|main|h[1-6]|li|ul|ol|br|hr|blockquote|figure|figcaption|tr|table|pre)\b[^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
	"&nbsp;": " ",
	"&mdash;": "—",
	"&ndash;": "–",
	"&hellip;": "…",
	"&rsquo;": "’",
	"&lsquo;": "‘",
	"&ldquo;": "“",
	"&rdquo;": "”",
};

/** The largest valid Unicode code point; String.fromCodePoint throws above it. */
const MAX_CODE_POINT = 0x10ffff;

/** Decode a numeric entity, leaving malformed/out-of-range ones untouched. */
const codePointToString = (codePoint: number, original: string): string =>
	codePoint <= MAX_CODE_POINT ? String.fromCodePoint(codePoint) : original;

const decodeEntities = (input: string): string =>
	input
		.replace(/&#x([0-9a-f]+);/gi, (match, hex: string) =>
			codePointToString(Number.parseInt(hex, 16), match),
		)
		.replace(/&#(\d+);/g, (match, code: string) =>
			codePointToString(Number(code), match),
		)
		.replace(
			/&[a-z]+;/gi,
			(match) => NAMED_ENTITIES[match.toLowerCase()] ?? match,
		);

export const htmlToNarration = ({ html }: { html: string }): Narration => {
	const decoded = decodeEntities(
		html
			.replace(REMOVABLE_BLOCK, " ")
			.replace(BLOCK_TAG, "\n")
			.replace(ANY_TAG, ""),
	);
	const text = decoded
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n+ */g, "\n")
		.trim();
	const words = text.split(/\s+/).filter((token) => token.length > 0).length;
	const characters = text.length;
	return {
		text,
		characters,
		words,
		estimatedAudioMinutes: audioMinutesForChars({ characters }),
	};
};
