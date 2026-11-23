import assert from "node:assert/strict";
import { articleBody } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../reader-slot/section-pages";
import { renderHighlightToolbar } from "./highlight-toolbar.component";
import {
	boundariesOf,
	coverageOf,
	initPendingHighlights,
	type Passage,
	passageOf,
	type ReaderFetch,
	STALLED_SAVE_MS,
} from "./pending-highlight.client";

const SCOPE = { articleId: "abc", readlist: [], surface: [] };
const CONTENT = "<p>Alpha beta gamma.</p><p>Delta <em>epsilon</em> zeta.</p>";
const BETA: Passage = { exact: "beta", start: 6, end: 10 };

function mainHtml(input: { content?: string; refusal?: string; section?: number; articleId?: string } = {}): string {
	const reader = renderReaderReady({
		readerSection: { requested: undefined, readerPath: "/queue/abc/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES },
		url: "https://example.com/post",
		content: articleBody(input.content ?? CONTENT),
		appOrigin: "https://readplace.com",
	}).html;
	const toolbar = renderHighlightToolbar({
		scope: { ...SCOPE, articleId: input.articleId ?? SCOPE.articleId },
		rowNoteOpen: false,
		section: input.section,
		refusal: input.refusal === undefined ? undefined : { code: input.refusal, message: "Refused" },
	});
	return `<main>${toolbar}${reader}<p id="outside">Outside</p></main>`;
}

interface FakeXhr {
	onload: (...args: unknown[]) => void;
	loads: number;
}

function harness(bodyHtml: string = mainHtml()) {
	const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
	const doc = dom.window.document;
	const timers = new Map<number, () => void>();
	let nextHandle = 1;
	const h = {
		doc,
		window: dom.window,
		paintSupported: true,
		painted: [] as Range[],
		cleared: 0,
		fetched: [] as string[],
		answer: async (): Promise<ReaderFetch> => ({ ok: false, html: "" }),
		resubmitted: [] as string[],
		aborts: 0,
		runTimers() {
			for (const [handle, callback] of timers) {
				timers.delete(handle);
				callback();
			}
		},
	};
	doc.addEventListener("htmx:abort", () => {
		h.aborts += 1;
	});
	const selectionOf = () => {
		const selection = doc.getSelection();
		assert(selection);
		return selection;
	};
	const pending = initPendingHighlights({
		document: doc,
		timers: {
			setTimeout: (callback, delayMs) => {
				assert.equal(delayMs, STALLED_SAVE_MS);
				const handle = nextHandle++;
				timers.set(handle, callback);
				return handle;
			},
			clearTimeout: (handle) => {
				if (typeof handle === "number") timers.delete(handle);
			},
		},
		selectionOf,
		paintPending: (range) => {
			if (h.paintSupported) h.painted.push(range);
			return h.paintSupported;
		},
		clearPending: () => {
			h.cleared += 1;
		},
		fetchReader: (url) => {
			h.fetched.push(url);
			return h.answer();
		},
		parseHtml: (html) => new JSDOM(html).window.document,
		resubmit: (range) => {
			h.resubmitted.push(range.toString());
		},
	});
	const form = () => {
		const found = doc.querySelector<HTMLFormElement>("[data-highlight-create-form]");
		assert(found);
		return found;
	};
	const content = () => {
		const found = doc.querySelector(".article-body__content");
		assert(found);
		return found;
	};
	const rangeOf = (exact: string): Range => {
		const walker = doc.createTreeWalker(content(), dom.window.NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
			const at = (node.textContent ?? "").indexOf(exact);
			if (at < 0) continue;
			const range = doc.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + exact.length);
			return range;
		}
		throw new Error(`no text node holds ${exact}`);
	};
	const fire = (target: EventTarget, type: string, detail: Record<string, unknown>) =>
		target.dispatchEvent(new dom.window.CustomEvent(type, { bubbles: true, detail }));
	const xhr = (): FakeXhr => {
		const fake: FakeXhr = {
			loads: 0,
			onload: () => {
				fake.loads += 1;
			},
		};
		return fake;
	};
	const begin = (exact = "beta"): FakeXhr => {
		const range = rangeOf(exact);
		const passage = passageOf({ range, content: content() });
		assert(passage);
		pending.begin({ form: form(), range, passage });
		const request = xhr();
		fire(form(), "htmx:beforeRequest", { elt: form(), xhr: request });
		fire(form(), "htmx:beforeSend", { elt: form(), xhr: request });
		return request;
	};
	const swapIn = (request: FakeXhr, html: string = mainHtml()) => {
		const main = doc.querySelector("main");
		assert(main);
		fire(main, "htmx:beforeSwap", { xhr: request, target: main });
		main.outerHTML = html;
		const swapped = doc.querySelector("main");
		assert(swapped);
		fire(swapped, "htmx:afterSwap", { xhr: request });
		fire(doc.body, "htmx:afterRequest", { xhr: request });
	};
	const status = () => doc.querySelector("[data-highlight-status-message]")?.textContent;
	const quote = () => doc.querySelector<HTMLElement>("[data-highlight-status-quote]");
	const action = (name: string) => {
		const button = doc.querySelector<HTMLButtonElement>(`[data-highlight-status-action="${name}"]`);
		assert(button);
		return button;
	};
	const region = () => {
		const found = doc.querySelector("[data-highlight-status]");
		assert(found);
		return found;
	};
	const select = (input: { from: string; to?: string; backward?: boolean }) => {
		const start = rangeOf(input.from);
		const end = rangeOf(input.to ?? input.from);
		const selection = selectionOf();
		if (input.backward) selection.setBaseAndExtent(end.endContainer, end.endOffset, start.startContainer, start.startOffset);
		else selection.setBaseAndExtent(start.startContainer, start.startOffset, end.endContainer, end.endOffset);
	};
	const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { h, pending, form, content, rangeOf, fire, xhr, begin, swapIn, status, quote, action, region, select, selectionOf, settled };
}

function readerPage(input: { content: string; articleId?: string }): string {
	return `<!doctype html><html><body>${mainHtml(input)}</body></html>`;
}

describe("passage mapping", () => {
	it("maps a normalised passage back onto the text nodes that hold it", () => {
		const t = harness();
		const boundaries = boundariesOf({ content: t.content(), passage: { exact: "epsilon zeta", start: 24, end: 36 } });
		assert(boundaries);
		const range = t.h.doc.createRange();
		range.setStart(boundaries.start.node, boundaries.start.offset);
		range.setEnd(boundaries.end.node, boundaries.end.offset);
		assert.equal(range.toString(), "epsilon zeta");
	});

	it("finds no boundaries when the text at the offsets no longer matches", () => {
		const t = harness();
		assert.equal(boundariesOf({ content: t.content(), passage: { ...BETA, exact: "bets" } }), undefined);
	});

	it("reads a passage as highlighted only when every word lies inside a mark", () => {
		const marked = new JSDOM(`<div><p>Alpha <mark class="article-highlight">beta</mark> <mark class="article-highlight">gamma</mark>.</p></div>`);
		const content = marked.window.document.querySelector("div");
		assert(content);
		assert.equal(coverageOf({ content, passage: { exact: "beta gamma", start: 6, end: 16 } }), "highlighted");
		assert.equal(coverageOf({ content, passage: { exact: "Alpha beta", start: 0, end: 10 } }), "absent");
		assert.equal(coverageOf({ content, passage: { exact: "Alpha bets", start: 0, end: 10 } }), "changed");
	});

	it("finds no passage in a range that holds no article text", () => {
		const t = harness();
		const range = t.h.doc.createRange();
		range.selectNodeContents(t.content());
		range.collapse(true);
		assert.equal(passageOf({ range, content: t.content() }), undefined);
	});
});

describe("painting a highlight while it saves", () => {
	it("paints the passage, keeps the article undimmed and announces the save", () => {
		const t = harness();
		assert.equal(t.pending.inFlight(), false);
		t.begin();

		assert.equal(t.pending.inFlight(), true);
		assert.deepEqual(t.h.painted.map((range) => range.toString()), ["beta"]);
		assert.equal(t.form().hasAttribute("data-highlight-pending"), true);
		assert.equal(t.status(), "Saving highlight");
		assert.equal(t.region().hasAttribute("data-highlight-status-shown"), false);
	});

	it("leaves the article dimmed where custom highlights cannot paint", () => {
		const t = harness();
		t.h.paintSupported = false;
		t.begin();

		assert.equal(t.form().hasAttribute("data-highlight-pending"), false);
		assert.equal(t.status(), "Saving highlight");
	});

	it("hands over to the server's marks once the matching reader is swapped in", () => {
		const t = harness();
		const request = t.begin();
		t.swapIn(request);

		assert.equal(t.pending.inFlight(), false);
		assert.equal(t.h.cleared, 1);
		assert.equal(t.status(), "");
		t.h.runTimers();
		assert.equal(t.status(), "");
	});

	it("follows only the request the create form started", () => {
		const t = harness();
		const range = t.rangeOf("beta");
		const passage = passageOf({ range, content: t.content() });
		assert(passage);
		t.pending.begin({ form: t.form(), range, passage });
		const other = t.xhr();
		t.fire(t.h.doc.body, "htmx:beforeRequest", { elt: t.h.doc.body, xhr: other });
		const own = t.xhr();
		t.fire(t.form(), "htmx:beforeRequest", { elt: t.form(), xhr: own });
		t.fire(t.form(), "htmx:beforeRequest", { elt: t.form(), xhr: t.xhr() });
		t.fire(t.h.doc.body, "htmx:afterSwap", { xhr: other });
		t.fire(t.h.doc.body, "htmx:afterSwap", {});

		assert.equal(t.pending.inFlight(), true);
		t.fire(t.h.doc.body, "htmx:afterSwap", { xhr: own });
		assert.equal(t.pending.inFlight(), false);
	});

	it("ignores request events while nothing is saving", () => {
		const t = harness();
		t.fire(t.form(), "htmx:beforeRequest", { elt: t.form(), xhr: t.xhr() });
		t.fire(t.form(), "htmx:beforeSend", { elt: t.form(), xhr: t.xhr() });
		t.fire(t.h.doc.body, "htmx:historyRestore", {});
		assert.equal(t.h.cleared, 0);
	});

	it("offers to stop waiting once the save stalls", () => {
		const t = harness();
		t.begin();
		t.h.runTimers();

		assert.equal(t.status(), "Still saving this highlight");
		assert.equal(t.action("stop").hidden, false);
		assert.equal(t.region().hasAttribute("data-highlight-status-shown"), true);
	});
});

describe("a save that ends without a reader", () => {
	it("says the passage may have saved and offers a check, without resending it", () => {
		const t = harness();
		const request = t.begin();
		t.h.runTimers();
		t.action("stop").click();
		assert.equal(t.h.aborts, 1);
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });

		assert.equal(t.pending.inFlight(), false);
		assert.equal(t.h.cleared, 1);
		assert.equal(t.status(), "Readplace may still have saved this passage:");
		assert.equal(t.quote()?.textContent, "beta");
		assert.equal(t.quote()?.hidden, false);
		assert.equal(t.action("check").hidden, false);
		assert.equal(t.action("stop").hidden, true);
		assert.equal(t.form().hasAttribute("data-highlight-pending"), false);
		assert.deepEqual(t.h.resubmitted, []);
	});

	it("does nothing when stop is pressed after the save ended", () => {
		const t = harness();
		t.action("stop").click();
		t.h.doc.querySelector<HTMLElement>("#outside")?.click();
		assert.equal(t.h.aborts, 0);
	});

	it.each([
		["highlighted", "Alpha beta gamma.", true, "This passage is highlighted:"],
		["absent", "Alpha beta gamma.", false, "This passage wasn't highlighted when Readplace checked:"],
		["changed", "Alpha bets gamma.", false, "Readplace couldn't check this highlight. Try again when you're online."],
	])("reports a %s passage after reading the reader in the background", async (_case, paragraph, marked, expected) => {
		const t = harness();
		const request = t.begin();
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });
		const page = readerPage({ content: `<p>${paragraph}</p>` });
		const html = marked ? page.replace("<p>Alpha beta", '<p>Alpha <mark class="article-highlight">beta</mark>') : page;
		t.h.answer = async () => ({ ok: true, html });
		t.action("check").click();
		assert.equal(t.status(), "Checking highlight");
		await t.settled();

		assert.equal(t.status(), expected);
		assert.equal(t.quote()?.textContent, "beta");
		assert.deepEqual(t.h.fetched, ["/queue/abc/view"]);
		assert.equal(t.action("check").hidden, false);
	});

	it.each([
		["a different reader answers", async () => ({ ok: true, html: readerPage({ content: CONTENT, articleId: "other" }) })],
		["the page has no article", async () => ({ ok: true, html: "<!doctype html><p>Sign in</p>" })],
		["the server refuses", async () => ({ ok: false, html: "" })],
		["the network fails", async (): Promise<ReaderFetch> => Promise.reject(new Error("offline"))],
	])("leaves the outcome unconfirmed when %s", async (_case, answer) => {
		const t = harness();
		const request = t.begin();
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });
		t.h.answer = answer;
		t.action("check").click();
		await t.settled();

		assert.equal(t.status(), "Readplace couldn't check this highlight. Try again when you're online.");
	});

	it("drops a check that answers after the reader moved on", async () => {
		const t = harness();
		const request = t.begin();
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });
		let answer: (fetched: ReaderFetch) => void = () => undefined;
		t.h.answer = () => new Promise((resolve) => (answer = resolve));
		t.action("check").click();
		t.fire(t.h.doc.body, "htmx:historyRestore", {});
		answer({ ok: true, html: readerPage({ content: CONTENT }) });
		await t.settled();

		assert.equal(t.status(), "Checking highlight");
	});

	it("forgets an unsure save once another reader replaces the page", () => {
		const t = harness();
		const request = t.begin();
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });
		const main = t.h.doc.querySelector("main");
		assert(main);
		t.fire(main, "htmx:beforeSwap", { xhr: t.xhr(), target: main });
		t.action("check").click();

		assert.deepEqual(t.h.fetched, []);
	});

	it("checks nothing when there is no unsure save", () => {
		const t = harness();
		t.action("check").click();
		assert.deepEqual(t.h.fetched, []);
	});
});

describe("selecting again while a save is pending", () => {
	it("holds the reader's answer until the drag in the article ends", () => {
		const t = harness();
		const request = t.begin();
		t.content().dispatchEvent(new t.h.window.Event("pointerdown", { bubbles: true }));
		request.onload();
		assert.equal(request.loads, 0);

		t.h.doc.dispatchEvent(new t.h.window.Event("pointerup"));
		assert.equal(request.loads, 1);
		t.h.doc.dispatchEvent(new t.h.window.Event("pointercancel"));
		assert.equal(request.loads, 1);
	});

	it("does not hold an answer for a press outside the article", () => {
		const t = harness();
		const request = t.begin();
		t.h.doc.querySelector("#outside")?.dispatchEvent(new t.h.window.Event("pointerdown", { bubbles: true }));
		request.onload();
		assert.equal(request.loads, 1);
	});

	it("applies a held answer when the reader stops waiting", () => {
		const t = harness();
		const request = t.begin();
		t.content().dispatchEvent(new t.h.window.Event("pointerdown", { bubbles: true }));
		request.onload();
		t.h.runTimers();
		t.action("stop").click();

		assert.equal(request.loads, 1);
		assert.equal(t.h.aborts, 0);
	});

	it("drops a held answer when another reader takes over the page", () => {
		const t = harness();
		const request = t.begin();
		t.content().dispatchEvent(new t.h.window.Event("pointerdown", { bubbles: true }));
		request.onload();
		const main = t.h.doc.querySelector("main");
		assert(main);
		t.fire(main, "htmx:beforeSwap", { xhr: t.xhr(), target: main });
		t.h.doc.dispatchEvent(new t.h.window.Event("pointerup"));

		assert.equal(request.loads, 0);
		assert.equal(t.pending.inFlight(), false);
		assert.equal(t.h.cleared, 1);
	});

	it("keeps a save through a swap elsewhere on the page", () => {
		const t = harness();
		t.begin();
		const outside = t.h.doc.querySelector("#outside");
		assert(outside);
		t.fire(outside, "htmx:beforeSwap", { xhr: t.xhr(), target: outside });
		t.fire(outside, "htmx:beforeSwap", { xhr: t.xhr(), target: undefined });

		assert.equal(t.pending.inFlight(), true);
	});

	it.each([false, true])("restores a selection made during the save (backward: %s)", (backward) => {
		const t = harness();
		const request = t.begin();
		t.select({ from: "epsilon", to: " zeta", backward });
		t.swapIn(request);

		const selection = t.selectionOf();
		assert.equal(selection.toString(), "epsilon zeta");
		const range = selection.getRangeAt(0);
		const anchorAtEnd = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
		assert.equal(anchorAtEnd, backward);
	});

	it.each([
		["the swapped reader is another article", mainHtml({ articleId: "other" })],
		["the swapped reader is another section", mainHtml({ section: 2 })],
		["the passage changed", mainHtml({ content: "<p>Alpha beta gamma.</p><p>Delta omicron zeta.</p>" })],
		["the swapped page has no article", "<main><p>Gone</p></main>"],
	])("leaves the new text unselected when %s", (_case, html) => {
		const t = harness();
		const request = t.begin();
		t.select({ from: "epsilon", to: " zeta" });
		t.swapIn(request, html);

		assert.equal(t.selectionOf().toString(), "");
	});

	it("restores nothing when no new selection was made", () => {
		const t = harness();
		const request = t.begin();
		t.selectionOf().removeAllRanges();
		t.swapIn(request);
		assert.equal(t.selectionOf().rangeCount, 0);
	});

	it("restores nothing for a selection outside the article", () => {
		const t = harness();
		const request = t.begin();
		const outside = t.h.doc.querySelector("#outside")?.firstChild;
		assert(outside);
		t.selectionOf().setBaseAndExtent(outside, 0, outside, 3);
		t.swapIn(request);
		assert.equal(t.selectionOf().toString(), "");
	});

	it("captures nothing when the article is already gone", () => {
		const t = harness();
		const request = t.begin();
		t.select({ from: "beta" });
		t.content().remove();
		t.swapIn(request);
		assert.equal(t.pending.inFlight(), false);
	});
});

describe("a refused save", () => {
	it("offers a retry for a recoverable refusal while the passage still reads the same", () => {
		const t = harness();
		const request = t.begin();
		t.swapIn(request, mainHtml({ refusal: "cancelled" }));

		assert.equal(t.status(), "Refused");
		assert.equal(t.action("retry").hidden, false);
		t.action("retry").click();
		assert.deepEqual(t.h.resubmitted, ["beta"]);
		t.action("retry").click();
		assert.deepEqual(t.h.resubmitted, ["beta"]);
	});

	it.each([
		["a refusal that needs a new selection", mainHtml({ refusal: "passage-changed" })],
		["a refusal from another reader", mainHtml({ refusal: "cancelled", articleId: "other" })],
		["a refusal over changed text", mainHtml({ refusal: "cancelled", content: "<p>Alpha bets gamma.</p>" })],
		["a refusal with no article", "<main><p>Gone</p></main>"],
	])("offers no retry for %s", (_case, html) => {
		const t = harness();
		const request = t.begin();
		t.swapIn(request, html);
		const retry = t.h.doc.querySelector<HTMLElement>('[data-highlight-status-action="retry"]');
		assert.equal(retry === null || retry.hidden, true);
	});

	it("does not retry once the passage changed under the offer", () => {
		const t = harness();
		const request = t.begin();
		t.swapIn(request, mainHtml({ refusal: "cancelled" }));
		const text = t.content().querySelector("p")?.firstChild;
		assert(text);
		text.textContent = "Alpha bets gamma.";
		t.action("retry").click();
		assert.deepEqual(t.h.resubmitted, []);
	});

	it("does not retry without an article on the page", () => {
		const t = harness();
		const request = t.begin();
		t.swapIn(request, mainHtml({ refusal: "cancelled" }));
		t.content().remove();
		t.action("retry").click();
		assert.deepEqual(t.h.resubmitted, []);
	});
});

describe("a reader with no highlight status", () => {
	it("still paints and hands over without announcing", () => {
		const t = harness(mainHtml().replace(/<div class="highlight-status"[\s\S]*?<\/div>\n<\/div>/, ""));
		assert.equal(t.h.doc.querySelector("[data-highlight-status]"), null);
		const request = t.begin();
		t.h.runTimers();
		t.fire(t.form(), "htmx:afterRequest", { xhr: request });
		t.h.doc.body.click();

		assert.equal(t.h.painted.length, 1);
		assert.equal(t.pending.inFlight(), false);
	});
});
