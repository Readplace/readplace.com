import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initDevelopers } from "./developers.client";
import { DevelopersPage } from "./developers.component";

interface FakeWatch {
	onChange: (changes: readonly { target: Element; isIntersecting: boolean }[]) => void;
	rootMargin: string;
	observed: Element[];
	disconnected: boolean;
}

const PAGE_HTML = DevelopersPage({ language: "http" }).content.html;

function setUp(options: { html?: string; clipboard?: boolean; narrow?: boolean; headerOffset?: number } = {}) {
	const document = new JSDOM(`<!doctype html><html><body>${options.html ?? PAGE_HTML}</body></html>`).window.document;
	const watches: FakeWatch[] = [];
	const settleListeners: (() => void)[] = [];
	const written: string[] = [];
	initDevelopers({
		document,
		navigator: options.clipboard
			? {
					clipboard: {
						writeText: async (text: string) => {
							written.push(text);
						},
					},
				}
			: {},
		setTimeoutFn: setTimeout,
		clearTimeoutFn: clearTimeout,
		observeIntersections: (onChange, observeOptions) => {
			const watch: FakeWatch = {
				onChange,
				rootMargin: observeOptions.rootMargin,
				observed: [],
				disconnected: false,
			};
			watches.push(watch);
			return {
				observe: (target) => watch.observed.push(target),
				disconnect: () => {
					watch.disconnected = true;
				},
			};
		},
		headerOffset: () => options.headerOffset ?? 124,
		isNarrowViewport: () => options.narrow ?? false,
		addSettleListener: (listener) => settleListeners.push(listener),
	});
	const settle = () => {
		for (const listener of settleListeners) listener();
	};
	return { document, watches, settle, written };
}

function element(document: Document, id: string): Element {
	const found = document.getElementById(id);
	assert(found, `the page must hold #${id}`);
	return found;
}

function currentLinks(document: Document): (string | null)[] {
	return Array.from(document.querySelectorAll('#on-this-page a[aria-current="location"]'), (link) =>
		link.getAttribute("href"),
	);
}

function latest(watches: FakeWatch[]): FakeWatch {
	const watch = watches.at(-1);
	assert(watch, "the script must observe the sections");
	return watch;
}

function copyButtons(document: Document): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-developers-copy]"));
}

describe("initDevelopers copy buttons", () => {
	it("adds one hidden Copy button per sample carrying that sample's text, revealed once a clipboard exists", () => {
		const { document } = setUp({ clipboard: true });
		const samples = Array.from(document.querySelectorAll(".developers__sample"));

		const buttons = copyButtons(document);

		assert.equal(buttons.length, samples.length);
		assert.deepEqual(
			buttons.map((button) => button.getAttribute("data-developers-text")),
			samples.map((sample) => sample.querySelector(".developers__code")?.textContent),
		);
		assert.deepEqual(
			buttons.map((button) => [button.hidden, button.textContent, button.getAttribute("aria-label")]),
			buttons.map(() => [false, "Copy", "Copy this sample"]),
		);
	});

	it("keeps every Copy button hidden without a clipboard", () => {
		const { document } = setUp({ clipboard: false });

		assert.deepEqual(
			copyButtons(document).map((button) => button.hidden),
			copyButtons(document).map(() => true),
		);
	});

	it("copies the sample's text when its button is clicked", async () => {
		const { document, written } = setUp({ clipboard: true });
		const [first] = copyButtons(document);
		assert(first, "the page must have a sample");

		first.click();
		await Promise.resolve();

		assert.deepEqual(written, [first.getAttribute("data-developers-text")]);
	});

	it("neither duplicates the buttons nor leaks the previous observer when htmx settles again", () => {
		const { document, watches, settle } = setUp({ clipboard: true });
		const before = copyButtons(document).length;

		settle();

		assert.equal(copyButtons(document).length, before);
		assert.deepEqual(
			watches.map((watch) => watch.disconnected),
			[true, false],
		);
	});
});

describe("initDevelopers navigation", () => {
	it("closes the on-this-page card on a narrow viewport", () => {
		const { document } = setUp({ narrow: true });

		assert.equal(element(document, "on-this-page").hasAttribute("open"), false);
	});

	it("leaves the on-this-page card open on a wide viewport", () => {
		const { document } = setUp({ narrow: false });

		assert.equal(element(document, "on-this-page").hasAttribute("open"), true);
	});

	it("marks the first link current before any section is seen", () => {
		const { document } = setUp();

		assert.deepEqual(currentLinks(document), ["#overview"]);
	});

	it("observes every linked section below the sticky header", () => {
		const { document, watches } = setUp({ headerOffset: 140 });
		const watch = latest(watches);

		assert.equal(watch.rootMargin, "-140px 0px -50% 0px");
		assert.deepEqual(
			watch.observed.map((target) => target.id),
			Array.from(document.querySelectorAll("#on-this-page a"), (link) => String(link.getAttribute("href")).slice(1)),
		);
	});

	it("marks a nested row over the section that holds it", () => {
		const { document, watches } = setUp();

		latest(watches).onChange([
			{ target: element(document, "authentication"), isIntersecting: true },
			{ target: element(document, "register"), isIntersecting: true },
		]);

		assert.deepEqual(currentLinks(document), ["#register"]);
	});

	it("marks the topmost of two visible sections", () => {
		const { document, watches } = setUp();

		latest(watches).onChange([
			{ target: element(document, "caching"), isIntersecting: true },
			{ target: element(document, "errors"), isIntersecting: true },
		]);

		assert.deepEqual(currentLinks(document), ["#caching"]);
	});

	it("keeps the last current link once nothing intersects", () => {
		const { document, watches } = setUp();
		const watch = latest(watches);
		watch.onChange([{ target: element(document, "limits"), isIntersecting: true }]);

		watch.onChange([{ target: element(document, "limits"), isIntersecting: false }]);

		assert.deepEqual(currentLinks(document), ["#limits"]);
	});

	it("refuses a navigation link whose section is missing", () => {
		assert.throws(
			() =>
				setUp({
					html: '<details id="on-this-page" open><a href="#nowhere">Nowhere</a></details>',
				}),
			/the developers page holds the section that #nowhere links to/,
		);
	});
});
