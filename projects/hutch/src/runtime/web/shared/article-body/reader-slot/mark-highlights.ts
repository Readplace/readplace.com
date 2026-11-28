import {
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	type Highlight,
	type HighlightId,
	highlightOnPage,
	type StoredHighlightState,
	storedHighlightState,
} from "@packages/domain/article";
import {
	collectTextChunks,
	type NormalisedText,
	normaliseText,
	type TextRange,
} from "@packages/domain/article/highlight";
import { parseFragmentRoot } from "../parse-fragment-root";
import { wrapHighlightMarks } from "../highlights/wrap-highlight-marks";
import { servedContentHash } from "./served-content-hash";

type RawSpan = NormalisedText["spans"][number];

export interface ReaderHighlights {
	rows: readonly Highlight[];
	canonicalContentHash: string | undefined;
}

export interface ReaderHighlightState {
	highlight: Highlight;
	place: TextRange | undefined;
	shown: StoredHighlightState;
}

export interface PageText {
	text: string;
	places: ReadonlyMap<HighlightId, TextRange>;
}

interface MarkedHighlights {
	html: string;
	text: string;
	page: PageText;
	states: readonly ReaderHighlightState[];
	noteEnds: ReadonlySet<HighlightId>;
}

function sameSpan(a: RawSpan | undefined, b: RawSpan): boolean {
	return a !== undefined && a.chunk === b.chunk && a.start === b.start && a.end === b.end;
}

function pageCharacters(input: {
	text: string;
	spans: readonly RawSpan[];
	chunks: readonly { text: string }[];
}): { text: string; offsets: readonly number[] } {
	let page = "";
	const offsets: number[] = [];
	let previous: RawSpan | undefined;
	for (let index = 0; index < input.text.length; index++) {
		offsets.push(page.length);
		const character = input.text[index];
		const span = input.spans[index];
		if (character === "\n" || character === " ") {
			page += character;
			previous = undefined;
			continue;
		}
		if (sameSpan(previous, span)) continue;
		page += input.chunks[span.chunk].text.slice(span.start, span.end);
		previous = span;
	}
	offsets.push(page.length);
	return { text: page, offsets };
}

export function markHighlights(input: {
	html: string;
	highlights: ReaderHighlights;
}): MarkedHighlights {
	const root = parseFragmentRoot(input.html);
	for (const mark of Array.from(root.querySelectorAll("mark"))) {
		mark.removeAttribute("class");
		mark.removeAttribute("id");
		mark.removeAttribute("data-highlight-id");
	}
	const chunks = collectTextChunks<ChildNode>(root);
	const normalised = normaliseText(chunks);
	const contentHash =
		input.highlights.canonicalContentHash ?? servedContentHash(normalised.text);
	const states = input.highlights.rows.map((highlight) => ({
		highlight,
		place: highlightOnPage({ text: normalised.text, contentHash, highlight }),
		shown: storedHighlightState({
			highlight,
			contentHash: input.highlights.canonicalContentHash,
		}),
	}));
	const noteEnds = wrapHighlightMarks({
		document: root.ownerDocument,
		root,
		chunks,
		spans: normalised.spans,
		highlights: states.map(({ highlight, place }) => ({
			highlightId: highlight.highlightId,
			note: highlight.note,
			place,
		})),
		idPrefix: ARTICLE_HIGHLIGHT_ID_PREFIX,
	});
	const page = pageCharacters({ text: normalised.text, spans: normalised.spans, chunks });
	const places = new Map<HighlightId, TextRange>();
	for (const { highlight, place } of states) {
		if (place !== undefined)
			places.set(highlight.highlightId, { start: page.offsets[place.start], end: page.offsets[place.end] });
	}
	return { html: root.innerHTML, text: normalised.text, page: { text: page.text, places }, states, noteEnds };
}
