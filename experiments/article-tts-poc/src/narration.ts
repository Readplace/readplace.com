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

/** Elements whose contents must never be spoken. */
const REMOVABLE_BLOCK =
	/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
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

const decodeEntities = (input: string): string =>
	input
		.replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_match, code: string) =>
			String.fromCodePoint(Number(code)),
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
		.replace(/\n{3,}/g, "\n\n")
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
