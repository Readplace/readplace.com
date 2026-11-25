const COPY_SELECTOR = "[data-highlight-copy]";
const SOURCE_SELECTOR = "[data-highlight-copy-source]";
const EXCERPT_SELECTOR = ".highlights-rail__excerpt";
const STATUS_SELECTOR = "[data-highlight-copy-status]";

export const HAS_CLIPBOARD_CLASS = "has-clipboard";
export const COPY_STATUS_CLEAR_MS = 4000;

export interface HighlightClipboard {
	writeText(text: string): Promise<void>;
}

interface HighlightCopyTimers {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function initHighlightCopy(deps: {
	document: Document;
	clipboard: HighlightClipboard | undefined;
	timers: HighlightCopyTimers;
	sendBeacon: (url: string) => void;
}): void {
	const { document, clipboard } = deps;
	if (clipboard === undefined) return;
	document.documentElement.classList.add(HAS_CLIPBOARD_CLASS);
	let clearing: unknown;

	const statusOf = (): Element => {
		const status = document.querySelector(STATUS_SELECTOR);
		assert(status, "a page with highlight copy buttons renders the copy status region");
		return status;
	};

	const announce = (input: { status: Element; textAttribute: string }): void => {
		deps.timers.clearTimeout(clearing);
		input.status.textContent = input.status.getAttribute(input.textAttribute);
		clearing = deps.timers.setTimeout(() => {
			input.status.textContent = "";
		}, COPY_STATUS_CLEAR_MS);
	};

	document.addEventListener("click", (event) => {
		const path = event.composedPath();
		const button = Array.from(document.querySelectorAll(COPY_SELECTOR)).find((candidate) => path.includes(candidate));
		if (button === undefined) return;
		const row = button.closest(SOURCE_SELECTOR);
		assert(row, "a highlight copy button sits in a highlight row");
		const excerpt = row.querySelector(EXCERPT_SELECTOR);
		assert(excerpt, "a highlight row holds its excerpt");
		const text = excerpt.textContent;
		assert(text !== null, "an element always has text content");
		clipboard.writeText(text).then(
			() => {
				const status = statusOf();
				announce({ status, textAttribute: "data-copied-text" });
				const url = status.getAttribute("data-copied-url");
				assert(url, "the copy status region names its copied beacon");
				deps.sendBeacon(url);
			},
			() => {
				const selection = document.getSelection();
				assert(selection, "a live document always has a selection");
				selection.selectAllChildren(excerpt);
				announce({ status: statusOf(), textAttribute: "data-copy-failed-text" });
			},
		);
	});
}
