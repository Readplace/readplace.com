import assert from "node:assert";
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
	normaliseText,
	type TextRange,
} from "@packages/domain/article/highlight";
import { parseHTML } from "linkedom";
import { wrapHighlightMarks } from "../highlights/wrap-highlight-marks";
import { servedContentHash } from "./served-content-hash";

export interface ReaderHighlights {
	rows: readonly Highlight[];
	canonicalContentHash: string | undefined;
}

export interface ReaderHighlightState {
	highlight: Highlight;
	place: TextRange | undefined;
	shown: StoredHighlightState;
}

interface MarkedHighlights {
	html: string;
	text: string;
	states: readonly ReaderHighlightState[];
	noteEnds: ReadonlySet<HighlightId>;
}

export function markHighlights(input: {
	html: string;
	highlights: ReaderHighlights;
}): MarkedHighlights {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-highlights-root">${input.html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-highlights-root");
	assert(root, "parseHTML must produce the reader-highlights wrapper div");
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
		document,
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
	return { html: root.innerHTML, text: normalised.text, states, noteEnds };
}
