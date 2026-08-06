import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initReaderExitConfirm } from "./reader-exit-confirm.client";

const PAGE_URL = "http://localhost:3000/queue/abc/view";
const STATUS_PATH = "/queue/abc/status?utm_source=reader&utm_medium=internal&utm_content=mark-read-exit";
const STATUS_URL = `http://localhost:3000${STATUS_PATH}`;
const PANEL_ID = "reader-exit-confirm";
const BOUND_FLAG = "data-reader-exit-confirm-bound";

const PANEL = `<div class="reader-confirm" id="${PANEL_ID}" popover="auto" role="dialog" tabindex="-1">
	<div class="reader-confirm__header">
		<h2 class="reader-confirm__title" id="${PANEL_ID}-title">Mark "Saved Post" as read?</h2>
		<button class="reader-confirm__close" id="exit-dismiss" type="button" popovertarget="${PANEL_ID}" popovertargetaction="hide">Close</button>
	</div>
	<form class="reader-confirm__form" method="POST" action="${STATUS_PATH}">
		<input type="hidden" name="status" value="read">
		<button class="btn btn--primary reader-confirm__cta" id="exit-yes" type="submit">Yes</button>
		<button class="btn btn--secondary reader-confirm__cta reader-confirm__cta--no" id="exit-no" type="button">No</button>
	</form>
</div>`;

const READER = `<main class="reader">
	<div class="article-body__content">
		<a id="body-link" href="https://example.com/out">out</a>
		<a id="nested-link" href="https://example.com/nested"><span id="nested-span">deep</span></a>
		<a id="image-link" href="https://example.com/image"><img id="link-image" alt=""></a>
		<a id="top-link" href="https://example.com/top" target="_top">top</a>
		<a id="uppercase-top-link" href="https://example.com/upper" target="_TOP">upper</a>
		<a id="self-link" href="https://example.com/self" target="_self">self</a>
		<a id="blank-link" href="https://example.com/blank" target="_blank">blank</a>
		<a id="uppercase-blank-link" href="https://example.com/upper-blank" target="_BLANK">upper blank</a>
		<a id="fragment-link" href="#section">fragment</a>
		<a id="empty-link" href="">empty</a>
		<a id="mailto-link" href="mailto:hi@example.com">mail</a>
		<a id="hrefless-link">no href</a>
		<span id="plain-text">not a link</span>
	</div>
	<ul class="related-slot__list" id="related-list">
		<li><a class="related-slot__link" id="related-link" href="/queue/def/view">related</a></li>
	</ul>
	<div class="reader__share-row"><a id="outside-link" href="https://example.com/outside">outside</a></div>
</main>`;

interface FetchCall {
	url: string;
	init: RequestInit;
}

function createHarness(options: { withPanel?: boolean; supportsPopover?: boolean } = {}) {
	const body = options.withPanel === false ? READER : READER + PANEL;
	// A pass-through click is a real navigation attempt jsdom cannot perform;
	// an unwired console keeps its "Not implemented" report out of the run.
	const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
		url: PAGE_URL,
		virtualConsole: new VirtualConsole(),
	});
	const document = dom.window.document;
	const shown: string[] = [];
	const hidden: string[] = [];
	const fetches: FetchCall[] = [];
	const navigations: string[] = [];
	let settleFetch: { resolve: () => void; reject: () => void } | null = null;

	initReaderExitConfirm({
		document,
		supportsPopover: () => options.supportsPopover !== false,
		showPopover: (panel) => {
			shown.push(panel.id);
		},
		hidePopover: (panel) => {
			hidden.push(panel.id);
		},
		fetchFn: (url, init) => {
			fetches.push({ url, init });
			return new Promise<unknown>((resolve, reject) => {
				settleFetch = { resolve: () => resolve(undefined), reject: () => reject(new Error("offline")) };
			});
		},
		navigate: (href) => {
			navigations.push(href);
		},
	});

	function element(id: string): Element {
		const found = document.getElementById(id);
		assert(found, `#${id} must exist in the fixture`);
		return found;
	}

	return {
		document,
		shown,
		hidden,
		fetches,
		navigations,
		element,
		/** false ⇔ the module cancelled the click, so the browser would not navigate. */
		click(id: string, init: MouseEventInit = {}): boolean {
			return element(id).dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
			);
		},
		clickDocument(): boolean {
			return document.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		},
		cancelClicksUpstream(): void {
			dom.window.addEventListener("click", (event) => event.preventDefault(), true);
		},
		recordClicksOn(id: string): string[] {
			const seen: string[] = [];
			element(id).addEventListener("click", () => seen.push(id));
			return seen;
		},
		submitConfirmForm(): boolean {
			const form = document.querySelector(".reader-confirm__form");
			assert(form, "the confirmation form must exist in the fixture");
			return form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
		},
		submitFrom(id: string): boolean {
			return element(id).dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
		},
		submitDocument(): boolean {
			return document.dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
		},
		toggle(newState: string): void {
			const event = new dom.window.Event("toggle");
			Object.defineProperty(event, "newState", { value: newState });
			element(PANEL_ID).dispatchEvent(event);
		},
		replaceRelatedList(): void {
			element("related-list").innerHTML =
				'<li><a class="related-slot__link" id="polled-link" href="/queue/ghi/view">polled</a></li>';
		},
		removePanel(): void {
			element(PANEL_ID).remove();
		},
		async resolveFetch(): Promise<void> {
			assert(settleFetch, "a fetch must have been issued");
			settleFetch.resolve();
			await Promise.resolve();
		},
		async rejectFetch(): Promise<void> {
			assert(settleFetch, "a fetch must have been issued");
			settleFetch.reject();
			await Promise.resolve();
		},
	};
}

describe("initReaderExitConfirm — interception", () => {
	it("cancels an article-body link and opens the confirmation instead", () => {
		const harness = createHarness();

		const followed = harness.click("body-link");

		assert.equal(followed, false);
		assert.deepEqual(harness.shown, [PANEL_ID]);
		assert.deepEqual(harness.navigations, []);
	});

	it("intercepts a click on markup nested inside the link", () => {
		const harness = createHarness();

		assert.equal(harness.click("nested-span"), false);
		assert.equal(harness.click("link-image"), false);
		assert.deepEqual(harness.shown, [PANEL_ID, PANEL_ID]);
	});

	it("intercepts a same-page link the reader retargeted to _top", () => {
		const harness = createHarness();

		assert.equal(harness.click("top-link"), false);
		assert.equal(harness.click("self-link"), false);
		assert.deepEqual(harness.shown, [PANEL_ID, PANEL_ID]);
	});

	it("matches target keywords case-insensitively, the way the browser navigates them", () => {
		const harness = createHarness();

		assert.equal(harness.click("uppercase-top-link"), false, "_TOP navigates this tab");
		assert.deepEqual(harness.shown, [PANEL_ID]);
	});

	it("intercepts a root-relative similar-article link and stashes its absolute destination", () => {
		const harness = createHarness();

		assert.equal(harness.click("related-link"), false);
		harness.click("exit-no");

		assert.deepEqual(harness.navigations, ["http://localhost:3000/queue/def/view"]);
	});
});

describe("initReaderExitConfirm — capture ordering", () => {
	it("keeps the click away from the boost handler bound on the link itself", () => {
		const harness = createHarness();
		const boostHandler = harness.recordClicksOn("related-link");

		harness.click("related-link");

		assert.deepEqual(boostHandler, []);
		assert.deepEqual(harness.shown, [PANEL_ID]);
	});

	it("leaves a pass-through click reaching the handlers bound on the link", () => {
		const harness = createHarness();
		const boostHandler = harness.recordClicksOn("blank-link");

		harness.click("blank-link");

		assert.deepEqual(boostHandler, ["blank-link"]);
		assert.deepEqual(harness.shown, []);
	});
});

describe("initReaderExitConfirm — pass-through", () => {
	it("leaves links outside the article body and the similar-article list alone", () => {
		const harness = createHarness();

		assert.equal(harness.click("outside-link"), true);
		assert.deepEqual(harness.shown, []);
	});

	it("leaves new-tab links alone, whatever the keyword's case", () => {
		const harness = createHarness();

		assert.equal(harness.click("blank-link"), true);
		assert.equal(harness.click("uppercase-blank-link"), true, "_BLANK opens a new tab");
		assert.deepEqual(harness.shown, []);
	});

	it("leaves a modified click to the browser's own new-tab handling", () => {
		for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
			const harness = createHarness();

			assert.equal(harness.click("body-link", { [modifier]: true }), true, modifier);
			assert.deepEqual(harness.shown, [], modifier);
		}
	});

	it("leaves a non-primary button click alone", () => {
		const harness = createHarness();

		assert.equal(harness.click("body-link", { button: 1 }), true);
		assert.deepEqual(harness.shown, []);
	});

	it("leaves in-page anchors, empty hrefs and non-http schemes alone", () => {
		const harness = createHarness();

		assert.equal(harness.click("fragment-link"), true);
		assert.equal(harness.click("empty-link"), true);
		assert.equal(harness.click("mailto-link"), true);
		assert.equal(harness.click("hrefless-link"), true);
		assert.deepEqual(harness.shown, []);
	});

	it("leaves a click that is not on a link alone", () => {
		const harness = createHarness();

		assert.equal(harness.click("plain-text"), true);
		assert.equal(harness.clickDocument(), true);
		assert.deepEqual(harness.shown, []);
	});

	it("leaves a click another handler already cancelled alone", () => {
		const harness = createHarness();
		harness.cancelClicksUpstream();

		harness.click("body-link");

		assert.deepEqual(harness.shown, []);
	});
});

describe("initReaderExitConfirm — lifecycle", () => {
	it("navigates natively when the article is already read and the server renders no panel", () => {
		const harness = createHarness({ withPanel: false });

		assert.equal(harness.click("body-link"), true);
		assert.deepEqual(harness.shown, []);
	});

	it("looks the panel up per click, so a panel removed by a swap stops the interception", () => {
		const harness = createHarness();
		assert.equal(harness.click("body-link"), false);

		harness.removePanel();

		assert.equal(harness.click("nested-link"), true);
		assert.deepEqual(harness.shown, [PANEL_ID]);
	});

	it("intercepts a similar-article link the 3s poll spliced in after init", () => {
		const harness = createHarness();
		harness.replaceRelatedList();

		assert.equal(harness.click("polled-link"), false);
		assert.deepEqual(harness.shown, [PANEL_ID]);
	});

	it("navigates natively when the engine has no popover support", () => {
		const harness = createHarness({ supportsPopover: false });

		assert.equal(harness.click("body-link"), true);
		assert.deepEqual(harness.shown, []);
	});
});

describe("initReaderExitConfirm — confirming", () => {
	it("posts the mark-read form from the DOM and then follows the link", async () => {
		const harness = createHarness();
		harness.click("body-link");

		const submitted = harness.submitConfirmForm();

		assert.equal(submitted, false, "the panel form never submits natively");
		assert.deepEqual(harness.fetches, [
			{
				url: STATUS_URL,
				init: {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: "status=read",
					keepalive: true,
					redirect: "manual",
				},
			},
		]);
		assert.deepEqual(harness.hidden, [PANEL_ID]);
		assert.deepEqual(harness.navigations, ["https://example.com/out"]);
		await harness.resolveFetch();
	});

	it("follows the link even when the mark-read request fails", async () => {
		const harness = createHarness();
		harness.click("body-link");
		harness.submitConfirmForm();

		await harness.rejectFetch();

		assert.deepEqual(harness.navigations, ["https://example.com/out"]);
	});

	it("marks read only once — a second submit with nothing pending does nothing", () => {
		const harness = createHarness();
		harness.click("body-link");
		harness.submitConfirmForm();

		harness.submitConfirmForm();

		assert.equal(harness.fetches.length, 1);
		assert.deepEqual(harness.navigations, ["https://example.com/out"]);
	});

	it("ignores a submit that did not come from the confirmation form", () => {
		const harness = createHarness();
		harness.click("body-link");

		assert.equal(harness.submitFrom("body-link"), true);
		assert.equal(harness.submitDocument(), true);
		assert.deepEqual(harness.fetches, []);
	});
});

describe("initReaderExitConfirm — declining", () => {
	it("follows the link without marking the article read", () => {
		const harness = createHarness();
		harness.click("body-link");

		harness.click("exit-no");

		assert.deepEqual(harness.fetches, []);
		assert.deepEqual(harness.hidden, [PANEL_ID]);
		assert.deepEqual(harness.navigations, ["https://example.com/out"]);
	});

	it("does nothing when nothing is pending", () => {
		const harness = createHarness();

		harness.click("exit-no");

		assert.deepEqual(harness.navigations, []);
		assert.deepEqual(harness.hidden, []);
	});
});

describe("initReaderExitConfirm — dismissing", () => {
	it("drops the pending destination when the panel closes, so the reader stays put", () => {
		const harness = createHarness();
		harness.click("body-link");

		harness.toggle("closed");
		harness.click("exit-no");

		assert.deepEqual(harness.navigations, []);
		assert.deepEqual(harness.fetches, []);
	});

	it("keeps the pending destination while the panel opens", () => {
		const harness = createHarness();
		harness.click("body-link");

		harness.toggle("open");
		harness.click("exit-no");

		assert.deepEqual(harness.navigations, ["https://example.com/out"]);
	});

	it("binds the dismissal listener once across repeated opens", () => {
		const harness = createHarness();
		harness.click("body-link");
		harness.toggle("closed");

		assert.equal(harness.click("nested-link"), false);
		assert.equal(harness.element(PANEL_ID).getAttribute(BOUND_FLAG), "true");
		assert.deepEqual(harness.shown, [PANEL_ID, PANEL_ID]);

		harness.toggle("closed");
		harness.click("exit-no");
		assert.deepEqual(harness.navigations, []);
	});
});
