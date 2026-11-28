import type { TextRange } from "@packages/domain/article/highlight";

const SHORT_QUOTE_WORDS = 12;
const TERM_WORDS = 6;
const CONTEXT_WORDS = 3;

interface FragmentTerms {
	prefix: string | undefined;
	start: string;
	end: string | undefined;
	suffix: string | undefined;
}

function foldForSearch(text: string): string {
	return text
		.split("")
		.map((unit) => unit.normalize("NFD").charAt(0).toLowerCase())
		.join("");
}

function wordsOf(text: string): string[] {
	return text.split(/\s+/).filter((word) => word.length > 0);
}

function termsOf(passage: string): Pick<FragmentTerms, "start" | "end"> {
	const blocks = passage.split("\n").map(wordsOf).filter((words) => words.length > 0);
	const first = blocks[0];
	const last = blocks[blocks.length - 1];
	if (blocks.length === 1 && first.length <= SHORT_QUOTE_WORDS) return { start: first.join(" "), end: undefined };
	return { start: first.slice(0, TERM_WORDS).join(" "), end: last.slice(-TERM_WORDS).join(" ") };
}

function firstMatchStart(input: { folded: string; terms: FragmentTerms }): number {
	const { terms } = input;
	const lead = terms.prefix === undefined ? "" : `${terms.prefix} `;
	const single = terms.end === undefined && terms.suffix !== undefined ? ` ${terms.suffix}` : "";
	return input.folded.indexOf(foldForSearch(`${lead}${terms.start}${single}`)) + lead.length;
}

function contextBefore(input: { pageText: string; at: number }): string | undefined {
	const blockStart = input.pageText.lastIndexOf("\n", input.at - 1) + 1;
	const before = input.pageText.slice(blockStart, input.at);
	if (!before.endsWith(" ")) return undefined;
	return wordsOf(before).slice(-CONTEXT_WORDS).join(" ");
}

function contextAfter(input: { pageText: string; at: number }): string | undefined {
	const blockEnd = input.pageText.indexOf("\n", input.at);
	const after = input.pageText.slice(input.at, blockEnd === -1 ? undefined : blockEnd);
	if (!after.startsWith(" ")) return undefined;
	return wordsOf(after).slice(0, CONTEXT_WORDS).join(" ");
}

function encodeTerm(term: string): string {
	return encodeURIComponent(term).replaceAll("-", "%2D");
}

function directive(terms: FragmentTerms): string {
	const parts = [
		...(terms.prefix === undefined ? [] : [`${encodeTerm(terms.prefix)}-`]),
		encodeTerm(terms.start),
		...(terms.end === undefined ? [] : [encodeTerm(terms.end)]),
		...(terms.suffix === undefined ? [] : [`-${encodeTerm(terms.suffix)}`]),
	];
	return `#:~:text=${parts.join(",")}`;
}

export function highlightTextFragment(input: { pageText: string; place: TextRange }): string | undefined {
	const { pageText, place } = input;
	const raw = pageText.slice(place.start, place.end);
	const passageStart = place.start + (raw.length - raw.trimStart().length);
	const passageEnd = place.start + raw.trimEnd().length;
	const words = termsOf(raw);
	const folded = foldForSearch(pageText);
	const bare: FragmentTerms = { prefix: undefined, ...words, suffix: undefined };
	if (firstMatchStart({ folded, terms: bare }) === passageStart) return directive(bare);
	const withContext: FragmentTerms = {
		prefix: contextBefore({ pageText, at: passageStart }),
		...words,
		suffix: contextAfter({ pageText, at: passageEnd }),
	};
	return firstMatchStart({ folded, terms: withContext }) === passageStart ? directive(withContext) : undefined;
}
