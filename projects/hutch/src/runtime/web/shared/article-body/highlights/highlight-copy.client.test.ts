import assert from "node:assert/strict";
import { HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { renderHighlightPopoverPanel } from "../highlight-popover/highlight-popover.component";
import { COPY_STATUS_RESET_MS } from "./highlight-copy.client";
import { initHighlightCopy } from "./highlight-toolbar.client";
import { renderHighlightToolbar, renderLocalHighlightToolbar } from "./highlight-toolbar.component";

const HIGHLIGHT_ID = HighlightIdSchema.parse("66666666-6666-4666-8666-666666666666");
const LATER_ID = HighlightIdSchema.parse("77777777-7777-4777-8777-777777777777");
const QUOTE = "the passage the reader kept";
const COPIED = "Highlight copied";
const FAILED = "Couldn't copy the highlight. Select its text to copy it.";

interface FakeClipboard {
	writes: string[];
	settled(): Promise<void>;
	clipboard: { writeText(text: string): Promise<void> };
}

function clipboardThat(answer: "grants" | "refuses"): FakeClipboard {
	const writes: string[] = [];
	let last: Promise<void> = Promise.resolve();
	return {
		writes,
		settled: () => last.catch(() => undefined),
		clipboard: {
			writeText(text: string) {
				writes.push(text);
				last = answer === "grants" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
				return last;
			},
		},
	};
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

	it("refuses to reset a status the page no longer renders", async () => {
		const fake = clipboardThat("grants");
		const h = page({ fake });

		h.copyItem().click();
		await fake.settled();
		h.status().remove();

		expect(() => h.runLastTimer()).toThrow("a page that offers Copy highlight renders its copy status");
	});
});
