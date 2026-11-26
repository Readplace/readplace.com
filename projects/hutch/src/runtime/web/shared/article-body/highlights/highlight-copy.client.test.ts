import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { renderHighlightPopoverPanel } from "../highlight-popover/highlight-popover.component";
import { renderHighlightCopyStatus } from "../highlights-rail/highlight-copy-status.component";
import { renderHighlightsRail } from "../highlights-rail/highlights-rail.component";
import { COPY_FAILED_CLASS, COPY_STATUS_RESET_MS, RAIL_COPY_STATUS_CLEAR_MS } from "./highlight-copy.client";
import { initHighlightCopy } from "./highlight-toolbar.client";
import { renderHighlightToolbar, renderLocalHighlightToolbar } from "./highlight-toolbar.component";

const HIGHLIGHT_ID = HighlightIdSchema.parse("66666666-6666-4666-8666-666666666666");
const LATER_ID = HighlightIdSchema.parse("77777777-7777-4777-8777-777777777777");
const QUOTE = "the passage the reader kept";
const COPIED = "Highlight copied";
const FAILED = "Couldn't copy the highlight. Select its text to copy it.";

type ClipboardAnswer = "grants" | "refuses";

interface FakeClipboard {
	writes: string[];
	answer: ClipboardAnswer;
	settled(): Promise<void>;
	clipboard: { writeText(text: string): Promise<void> };
}

function clipboardThat(answer: ClipboardAnswer): FakeClipboard {
	const writes: string[] = [];
	let last: Promise<void> = Promise.resolve();
	const fake: FakeClipboard = {
		writes,
		answer,
		settled: () => last.catch(() => undefined),
		clipboard: {
			writeText(text: string) {
				writes.push(text);
				last = fake.answer === "grants" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
				return last;
			},
		},
	};
	return fake;
}

interface Timer {
	callback: () => void;
	delayMs: number;
}

function readerMain(toolbarHtml: string): string {
	return `<main><p id="article">An article with ${QUOTE} inside it.</p>${renderHighlightPopoverPanel({
		highlightId: HIGHLIGHT_ID,
		note: undefined,
		quote: QUOTE,
	})}${toolbarHtml}</main>`;
}

const APP_TOOLBAR = renderHighlightToolbar({
	scope: { articleId: "abc", readlist: [], surface: [["platform", "ios"]] },
	rowNoteOpen: false,
	section: undefined,
	refusal: undefined,
});

function page(input: { fake: FakeClipboard | undefined; toolbarHtml?: string }) {
	const dom = new JSDOM(
		`<!DOCTYPE html><html><body>${readerMain(input.toolbarHtml ?? APP_TOOLBAR)}<div class="sr-only" id="toast-live-region" role="status" aria-live="polite"></div></body></html>`,
		{ url: "https://readplace.com/queue/abc/view?platform=ios" },
	);
	const document = dom.window.document;
	const timers: Timer[] = [];
	const cleared: unknown[] = [];
	const beacons: string[] = [];
	const deps = {
		document,
		navigator: input.fake === undefined ? {} : { clipboard: input.fake.clipboard },
		setTimeoutFn: (callback: () => void, delayMs: number) => {
			const timer = { callback, delayMs };
			timers.push(timer);
			return timer;
		},
		clearTimeoutFn: (handle: unknown) => {
			cleared.push(handle);
		},
		sendBeacon: (url: string) => {
			beacons.push(url);
		},
	};
	initHighlightCopy(deps);
	const status = (): HTMLElement => {
		const element = document.querySelector<HTMLElement>("[data-highlight-copy-status]");
		assert(element, "the page renders the copy status");
		return element;
	};
	const region = (): HTMLElement => {
		const element = document.getElementById("toast-live-region");
		assert(element, "the page renders the toast live region");
		return element;
	};
	const copyItem = (id: string = HIGHLIGHT_ID): HTMLElement => {
		const element = document.querySelector<HTMLElement>(
			`[data-highlight-popover="${id}"] [data-test-action="highlight-panel-copy"]`,
		);
		assert(element, `the panel of ${id} offers Copy highlight`);
		return element;
	};
	const shown = () => ({
		status: status().textContent,
		hidden: status().hidden,
		announced: region().textContent,
	});
	const runLastTimer = (): void => {
		const timer = timers.at(-1);
		assert(timer, "a copy result schedules its reset");
		timer.callback();
	};
	return { dom, document, deps, timers, cleared, beacons, status, region, copyItem, shown, runLastTimer };
}

describe("initHighlightCopy", () => {
	it("writes exactly the highlight's text, shows and announces the success, and beacons with the app's platform", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });

		h.copyItem().click();
		await fake.settled();

		expect(h.document.documentElement.className).toBe("has-clipboard");
		expect(fake.writes).toEqual([QUOTE]);
		expect(h.shown()).toEqual({ status: COPIED, hidden: false, announced: COPIED });
		expect(h.status().classList.contains(COPY_FAILED_CLASS)).toBe(false);
		expect(h.beacons).toEqual([`/queue/abc/highlights/copied?platform=ios&highlight=${HIGHLIGHT_ID}&origin=panel`]);
		expect(h.timers.map((timer) => timer.delayMs)).toEqual([COPY_STATUS_RESET_MS]);
	});

	it("says the highlight could not be copied, leaves the selection and sends no beacon when the write is refused", async () => {
		const fake = clipboardThat("refuses");
		const h = page({ fake });
		const selection = h.dom.window.getSelection();
		assert(selection, "jsdom gives the page a selection");
		const article = h.document.getElementById("article");
		assert(article, "the article renders");
		selection.selectAllChildren(article);
		const before = selection.toString();

		h.copyItem().click();
		await fake.settled();

		expect(h.shown()).toEqual({ status: FAILED, hidden: false, announced: FAILED });
		expect(h.status().classList.contains(COPY_FAILED_CLASS)).toBe(true);
		expect(selection.toString()).toBe(before);
		expect(h.beacons).toEqual([]);
	});

	it("hides and empties the status when its reset runs, then announces a later copy again", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });

		h.copyItem().click();
		await fake.settled();
		h.runLastTimer();

		expect(h.shown()).toEqual({ status: "", hidden: true, announced: "" });

		h.copyItem().click();
		await fake.settled();

		expect(h.shown()).toEqual({ status: COPIED, hidden: false, announced: COPIED });
		expect(h.cleared).toEqual([]);
	});

	it("restarts the reset when a second copy lands before the first one's reset", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });

		h.copyItem().click();
		await fake.settled();
		h.copyItem().click();
		await fake.settled();

		expect(h.cleared).toEqual([h.timers[0]]);
		expect(h.timers).toHaveLength(2);
	});

	it("copies from a panel added after start-up", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });
		const main = h.document.querySelector("main");
		assert(main, "the reader renders main");
		main.insertAdjacentHTML(
			"beforeend",
			renderHighlightPopoverPanel({ highlightId: LATER_ID, note: undefined, quote: "a later passage" }),
		);

		h.copyItem(LATER_ID).click();
		await fake.settled();

		expect(fake.writes).toEqual(["a later passage"]);
		expect(h.beacons).toEqual([`/queue/abc/highlights/copied?platform=ios&highlight=${LATER_ID}&origin=panel`]);
	});

	it("shows its status in the fresh status element after main is replaced", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });
		const main = h.document.querySelector("main");
		assert(main, "the reader renders main");
		const stale = h.status();
		main.outerHTML = readerMain(APP_TOOLBAR);

		h.copyItem().click();
		await fake.settled();

		expect(h.status()).not.toBe(stale);
		expect(h.shown()).toEqual({ status: COPIED, hidden: false, announced: COPIED });
	});

	it("beacons the public event route with the copied action on /view", async () => {
		const fake = clipboardThat("grants");
		const h = page({
			fake,
			toolbarHtml: renderLocalHighlightToolbar({
				openedUrl: "/view/highlights/event",
				copiedUrl: "/view/highlights/event?action=copied",
			}),
		});

		h.copyItem().click();
		await fake.settled();

		expect(h.beacons).toEqual([`/view/highlights/event?action=copied&highlight=${HIGHLIGHT_ID}&origin=panel`]);
	});

	it("offers nothing where the clipboard API is absent", () => {
		const h = page({ fake: undefined });

		h.copyItem().click();

		expect(h.document.documentElement.className).toBe("");
		expect(h.shown()).toEqual({ status: "", hidden: true, announced: "" });
		expect(h.beacons).toEqual([]);
	});

	it("listens once when started twice on the same page", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });
		initHighlightCopy(h.deps);

		h.copyItem().click();
		await fake.settled();

		expect(fake.writes).toEqual([QUOTE]);
	});

	it("ignores clicks elsewhere on the page", () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });
		const article = h.document.getElementById("article");
		assert(article, "the article renders");

		article.click();

		expect(fake.writes).toEqual([]);
	});

	it("shows a copy that succeeds after a refused one as a success", async () => {
		const fake = clipboardThat("refuses");
		const h = page({ fake });

		h.copyItem().click();
		await fake.settled();
		fake.answer = "grants";
		h.copyItem().click();
		await fake.settled();

		expect(h.shown()).toEqual({ status: COPIED, hidden: false, announced: COPIED });
		expect(h.status().classList.contains(COPY_FAILED_CLASS)).toBe(false);
	});

	it.each([
		{ missing: "[data-highlight-copy-status]", message: "a page that offers Copy highlight renders its copy status" },
		{ missing: "[data-highlight-toolbar]", message: "a page that offers Copy highlight renders the highlight toolbar" },
	])("refuses to copy before writing when the page lacks $missing", ({ missing, message }) => {
		const fake = clipboardThat("grants");
		const h = page({ fake });
		h.document.querySelector(missing)?.remove();
		const errors: string[] = [];
		h.dom.window.addEventListener("error", (event) => {
			event.preventDefault();
			errors.push(event.message);
		});

		h.copyItem().click();

		expect(errors).toEqual([message]);
		expect(fake.writes).toEqual([]);
	});
});

const RAIL_HIGHLIGHT_ID = HighlightIdSchema.parse("11111111-1111-4111-8111-111111111111");
const RAIL_LONG_QUOTE = Array.from({ length: 40 }, (_, index) => `Sentence ${index + 1} of a long highlight.`).join(" ");
const RAIL_COPIED_URL = "/queue/abc/highlights/copied?platform=ios&origin=rail";

function railHtml(input: { quote: string; state: "anchored" | "orphaned" }): string {
	const row: Highlight = {
		highlightId: RAIL_HIGHLIGHT_ID,
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

interface RailHarness {
	doc: Document;
	copied: string[];
	beacons: string[];
	timers: Map<number, { callback: () => void; delayMs: number }>;
}

function railHarness(input: { clipboard: "accepts" | "refuses" | "absent"; quote?: string }): RailHarness {
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${railHtml({ quote: input.quote ?? RAIL_LONG_QUOTE, state: "anchored" })}${renderHighlightCopyStatus({ copiedUrl: RAIL_COPIED_URL })}</main></body></html>`,
		{ url: "https://readplace.com/queue/abc/view?platform=ios" },
	);
	const h: RailHarness = { doc: dom.window.document, copied: [], beacons: [], timers: new Map() };
	let nextHandle = 1;
	const clipboards: Record<typeof input.clipboard, { writeText(text: string): Promise<void> } | undefined> = {
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
	const clipboard = clipboards[input.clipboard];
	initHighlightCopy({
		document: h.doc,
		navigator: clipboard === undefined ? {} : { clipboard },
		setTimeoutFn: (callback, delayMs) => {
			const handle = nextHandle++;
			h.timers.set(handle, { callback, delayMs });
			return handle;
		},
		clearTimeoutFn: (handle) => {
			for (const key of h.timers.keys()) if (key === handle) h.timers.delete(key);
		},
		sendBeacon: (url) => h.beacons.push(url),
	});
	return h;
}

function railCopyButtonOf(h: RailHarness): HTMLElement {
	const button = h.doc.querySelector<HTMLElement>("[data-test-action='highlight-copy']");
	assert(button, "the rail row renders a Copy button");
	return button;
}

function railStatusOf(h: RailHarness): Element {
	const status = h.doc.querySelector("[data-test-highlight-rail-copy-status]");
	assert(status, "the page renders the copy status region");
	return status;
}

async function railSettle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

describe("initHighlightCopy on the Highlights rail", () => {
	it("copies the full quote of a long row, and not its note", async () => {
		const h = railHarness({ clipboard: "accepts" });

		railCopyButtonOf(h).click();
		await railSettle();

		assert.deepEqual(h.copied, [RAIL_LONG_QUOTE]);
	});

	it("announces the copy and reports it, with the row's highlight, to the beacon the status region names", async () => {
		const h = railHarness({ clipboard: "accepts" });

		railCopyButtonOf(h).click();
		await railSettle();

		assert.equal(railStatusOf(h).textContent, "Highlight copied");
		assert.deepEqual(h.beacons, [`/queue/abc/highlights/copied?platform=ios&origin=rail&highlight=${RAIL_HIGHLIGHT_ID}`]);
	});

	it("marks the document as able to copy", () => {
		const h = railHarness({ clipboard: "accepts" });

		assert.equal(h.doc.documentElement.classList.contains("has-clipboard"), true);
	});

	it("selects the quote and says so when the write is refused, without reporting a copy", async () => {
		const h = railHarness({ clipboard: "refuses" });
		const other = h.doc.createRange();
		other.selectNodeContents(railStatusOf(h));
		h.doc.getSelection()?.addRange(other);

		railCopyButtonOf(h).click();
		await railSettle();

		assert.equal(h.doc.getSelection()?.toString(), RAIL_LONG_QUOTE);
		assert.equal(
			railStatusOf(h).textContent,
			"Couldn't copy. The highlight is selected, so you can copy it from your device's menu.",
		);
		assert.deepEqual(h.beacons, []);
	});

	it("clears the status after a few seconds, so a later copy is announced again", async () => {
		const h = railHarness({ clipboard: "accepts" });

		railCopyButtonOf(h).click();
		await railSettle();
		railCopyButtonOf(h).click();
		await railSettle();

		assert.equal(h.timers.size, 1);
		const [clear] = h.timers.values();
		assert(clear);
		assert.equal(clear.delayMs, RAIL_COPY_STATUS_CLEAR_MS);
		clear.callback();
		assert.equal(railStatusOf(h).textContent, "");
	});

	it("copies from a rail that replaced the one present at start-up", async () => {
		const h = railHarness({ clipboard: "accepts" });
		const rail = h.doc.querySelector("#highlights-rail");
		assert(rail);
		rail.outerHTML = railHtml({ quote: "A passage that reads differently now", state: "orphaned" });

		railCopyButtonOf(h).click();
		await railSettle();

		assert.deepEqual(h.copied, ["A passage that reads differently now"]);
	});

	it("ignores clicks outside a Copy button", async () => {
		const h = railHarness({ clipboard: "accepts" });

		h.doc.querySelector<HTMLElement>("[data-test-highlight-rail-copy-status]")?.click();
		await railSettle();

		assert.deepEqual(h.copied, []);
	});

	it("leaves the button hidden and copies nothing without a clipboard", async () => {
		const h = railHarness({ clipboard: "absent" });

		railCopyButtonOf(h).click();
		await railSettle();

		assert.equal(h.doc.documentElement.classList.contains("has-clipboard"), false);
		assert.deepEqual(h.copied, []);
	});
});
