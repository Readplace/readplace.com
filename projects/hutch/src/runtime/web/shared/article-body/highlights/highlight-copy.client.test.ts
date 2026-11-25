import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { renderHighlightCopyStatus } from "../highlights-rail/highlight-copy-status.component";
import { renderHighlightsRail } from "../highlights-rail/highlights-rail.component";
import { COPY_STATUS_CLEAR_MS, type HighlightClipboard, initHighlightCopy } from "./highlight-copy.client";

const HIGHLIGHT_ID = HighlightIdSchema.parse("11111111-1111-4111-8111-111111111111");
const LONG_QUOTE = Array.from({ length: 40 }, (_, index) => `Sentence ${index + 1} of a long highlight.`).join(" ");
const COPIED_URL = "/queue/abc/highlights/copied?platform=ios";

function railHtml(input: { quote: string; state: "anchored" | "orphaned" }): string {
	const row: Highlight = {
		highlightId: HIGHLIGHT_ID,
		highlightOf: "https://example.com/post",
		exact: input.quote,
		prefix: "",
		suffix: "",
		start: 0,
		end: input.quote.length,
		anchoredContentHash: "hash",
		anchorState: input.state,
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
		note: "A private aside",
	};
	return renderHighlightsRail({
		rows: [{ highlight: row, shown: { state: input.state, edited: false, quote: input.quote }, marked: input.state === "anchored" }],
		scope: undefined,
		openNote: undefined,
		oob: false,
	}).html;
}

interface Harness {
	doc: Document;
	copied: string[];
	beacons: string[];
	timers: Map<number, { callback: () => void; delayMs: number }>;
}

function harness(input: { clipboard: "accepts" | "refuses" | "absent"; quote?: string }): Harness {
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${railHtml({ quote: input.quote ?? LONG_QUOTE, state: "anchored" })}${renderHighlightCopyStatus({ copiedUrl: COPIED_URL })}</main></body></html>`,
	);
	const h: Harness = { doc: dom.window.document, copied: [], beacons: [], timers: new Map() };
	let nextHandle = 1;
	const clipboards: Record<typeof input.clipboard, HighlightClipboard | undefined> = {
		accepts: {
			writeText: async (text) => {
				h.copied.push(text);
			},
		},
		refuses: {
			writeText: async () => {
				throw new Error("NotAllowedError");
			},
		},
		absent: undefined,
	};
	initHighlightCopy({
		document: h.doc,
		clipboard: clipboards[input.clipboard],
		timers: {
			setTimeout: (callback, delayMs) => {
				const handle = nextHandle++;
				h.timers.set(handle, { callback, delayMs });
				return handle;
			},
			clearTimeout: (handle) => {
				for (const key of h.timers.keys()) if (key === handle) h.timers.delete(key);
			},
		},
		sendBeacon: (url) => h.beacons.push(url),
	});
	return h;
}

function copyButtonOf(h: Harness): HTMLElement {
	const button = h.doc.querySelector<HTMLElement>("[data-test-action='highlight-copy']");
	assert(button, "the rail row renders a Copy button");
	return button;
}

function statusOf(h: Harness): Element {
	const status = h.doc.querySelector("[data-test-highlight-copy-status]");
	assert(status, "the page renders the copy status region");
	return status;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

describe("initHighlightCopy", () => {
	it("copies the full quote of a long row, and not its note", async () => {
		const h = harness({ clipboard: "accepts" });

		copyButtonOf(h).click();
		await settle();

		assert.deepEqual(h.copied, [LONG_QUOTE]);
	});

	it("announces the copy and reports it to the beacon the status region names", async () => {
		const h = harness({ clipboard: "accepts" });

		copyButtonOf(h).click();
		await settle();

		assert.equal(statusOf(h).textContent, "Highlight copied");
		assert.deepEqual(h.beacons, [statusOf(h).getAttribute("data-copied-url")]);
		assert.deepEqual(h.beacons, [COPIED_URL]);
	});

	it("marks the document as able to copy", () => {
		const h = harness({ clipboard: "accepts" });

		assert.equal(h.doc.documentElement.classList.contains("has-clipboard"), true);
	});

	it("selects the quote and says so when the write is refused, without reporting a copy", async () => {
		const h = harness({ clipboard: "refuses" });
		const other = h.doc.createRange();
		other.selectNodeContents(statusOf(h));
		h.doc.getSelection()?.addRange(other);

		copyButtonOf(h).click();
		await settle();

		assert.equal(h.doc.getSelection()?.toString(), LONG_QUOTE);
		assert.equal(
			statusOf(h).textContent,
			"Couldn't copy. The highlight is selected, so you can copy it from your device's menu.",
		);
		assert.deepEqual(h.beacons, []);
	});

	it("clears the status after a few seconds, so a later copy is announced again", async () => {
		const h = harness({ clipboard: "accepts" });

		copyButtonOf(h).click();
		await settle();
		copyButtonOf(h).click();
		await settle();

		assert.equal(h.timers.size, 1);
		const [clear] = h.timers.values();
		assert(clear);
		assert.equal(clear.delayMs, COPY_STATUS_CLEAR_MS);
		clear.callback();
		assert.equal(statusOf(h).textContent, "");
	});

	it("copies from a rail that replaced the one present at start-up", async () => {
		const h = harness({ clipboard: "accepts" });
		const rail = h.doc.querySelector("#highlights-rail");
		assert(rail);
		rail.outerHTML = railHtml({ quote: "A passage that reads differently now", state: "orphaned" });

		copyButtonOf(h).click();
		await settle();

		assert.deepEqual(h.copied, ["A passage that reads differently now"]);
	});

	it("ignores clicks outside a Copy button", async () => {
		const h = harness({ clipboard: "accepts" });

		h.doc.querySelector<HTMLElement>("[data-test-highlight-copy-status]")?.click();
		await settle();

		assert.deepEqual(h.copied, []);
	});

	it("leaves the button hidden and copies nothing without a clipboard", async () => {
		const h = harness({ clipboard: "absent" });

		copyButtonOf(h).click();
		await settle();

		assert.equal(h.doc.documentElement.classList.contains("has-clipboard"), false);
		assert.deepEqual(h.copied, []);
	});
});
