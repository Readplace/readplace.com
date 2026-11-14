import { blockTextOf } from "./block-text";
import { caretAtPoint } from "./caret-at-point";
import { sentenceBoundsAt } from "./sentence-bounds";

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

const CONTENT_SELECTOR = ".article-body__content";
const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, caption, td, th, div";
const IGNORED_SELECTOR = "a, button, summary, input, textarea, label, mark[data-highlight-id], img, video, pre";
const OVERLAY_SELECTOR = ".article-body__readlists[open], .nav__disclosure[open], .nav__user[open]";

export interface SentenceTapWindow {
	matchMedia(query: string): { readonly matches: boolean };
}

interface SentenceTapDeps {
	document: Document;
	window: SentenceTapWindow;
	isPopoverOpen: () => boolean;
	selectionOf: () => Selection;
	canHighlight: () => boolean;
}

interface TappedSentence {
	readonly startNode: Node;
	readonly startOffset: number;
	readonly endNode: Node;
	readonly endOffset: number;
}

export interface SentenceTap {
	isTapped(range: AbstractRange): boolean;
}

function lastOnPath(input: { path: EventTarget[]; candidates: NodeListOf<Element> }): Element | undefined {
	return Array.from(input.candidates)
		.filter((candidate) => input.path.includes(candidate))
		.at(-1);
}

export function initSentenceTap(deps: SentenceTapDeps): SentenceTap {
	const { document } = deps;
	let tapped: TappedSentence | undefined;
	let selectionWasCollapsed = false;
	let overlayWasOpen = false;

	const selectSentenceAt = (event: MouseEvent): void => {
		if (!deps.window.matchMedia(COARSE_POINTER_QUERY).matches) return;
		if (!deps.canHighlight()) return;
		if (!selectionWasCollapsed || overlayWasOpen) return;
		const content = document.querySelector(CONTENT_SELECTOR);
		const path = event.composedPath();
		if (content === null || !path.includes(content)) return;
		if (
			lastOnPath({
				path,
				candidates: content.querySelectorAll(IGNORED_SELECTOR),
			}) !== undefined
		)
			return;
		const block = lastOnPath({
			path,
			candidates: content.querySelectorAll(BLOCK_SELECTOR),
		});
		if (block === undefined) return;
		const caret = caretAtPoint({
			document,
			x: event.clientX,
			y: event.clientY,
		});
		if (caret === undefined) return;
		const blockText = blockTextOf(block);
		const offset = blockText.offsetOf(caret);
		if (offset === undefined) return;
		const bounds = sentenceBoundsAt({ text: blockText.text, offset });
		if (bounds === undefined) return;
		const start = blockText.pointAt(bounds.start);
		const end = blockText.pointAt(bounds.end);
		tapped = {
			startNode: start.node,
			startOffset: start.offset,
			endNode: end.node,
			endOffset: end.offset,
		};
		deps.selectionOf().setBaseAndExtent(start.node, start.offset, end.node, end.offset);
	};

	document.addEventListener(
		"pointerdown",
		() => {
			selectionWasCollapsed = deps.selectionOf().isCollapsed;
			overlayWasOpen = document.querySelector(OVERLAY_SELECTOR) !== null || deps.isPopoverOpen();
		},
		{ capture: true },
	);
	document.addEventListener("click", selectSentenceAt);

	return {
		isTapped: (range) =>
			tapped !== undefined &&
			range.startContainer === tapped.startNode &&
			range.startOffset === tapped.startOffset &&
			range.endContainer === tapped.endNode &&
			range.endOffset === tapped.endOffset,
	};
}
