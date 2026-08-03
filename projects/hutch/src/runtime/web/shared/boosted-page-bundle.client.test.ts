import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initBoostedPageBundle } from "./boosted-page-bundle.client";

const MARKER = "[data-bundle-root]";

function makeDocument(mainInner: string): Document {
	return new JSDOM(
		`<!doctype html><html><body><main>${mainInner}</main></body></html>`,
	).window.document;
}

function swapInNewMain(doc: Document, inner: string): Element {
	const oldMain = doc.querySelector("main");
	assert(oldMain, "fixture must render a <main>");
	const next = doc.createElement("main");
	next.innerHTML = inner;
	oldMain.replaceWith(next);
	return next;
}

function createHarness(doc: Document) {
	let swapListener: ((target: Element) => void) | undefined;
	const events: string[] = [];
	let instances = 0;
	initBoostedPageBundle({
		document: doc,
		selector: MARKER,
		addSwapListener: (listener) => {
			swapListener = listener;
		},
		create: () => {
			instances += 1;
			const id = instances;
			events.push(`create:${id}`);
			return () => {
				events.push(`cleanup:${id}`);
			};
		},
	});
	assert(swapListener, "the bundle must register a swap listener");
	return { swap: swapListener, events };
}

describe("initBoostedPageBundle", () => {
	it("creates against the initial DOM when the bundle's markup is present", () => {
		const doc = makeDocument(`<div data-bundle-root></div>`);
		const { events } = createHarness(doc);
		assert.deepEqual(events, ["create:1"]);
	});

	it("does not create when the initial DOM lacks the bundle's markup", () => {
		const doc = makeDocument(`<p>elsewhere</p>`);
		const { events } = createHarness(doc);
		assert.deepEqual(events, []);
	});

	it("ignores swaps that replace something other than <main>", () => {
		const doc = makeDocument(`<div data-bundle-root></div>`);
		const { swap, events } = createHarness(doc);

		const card = doc.createElement("div");
		swap(card);

		assert.deepEqual(events, ["create:1"]);
	});

	it("ignores the swap event for the <main> the bundle arrived in", () => {
		const doc = makeDocument(`<div data-bundle-root></div>`);
		const { swap, events } = createHarness(doc);

		const deliveredMain = doc.querySelector("main");
		assert(deliveredMain, "fixture must render a <main>");
		swap(deliveredMain);

		assert.deepEqual(events, ["create:1"]);
	});

	it("tears down the previous instance and re-creates when a new <main> arrives with the markup", () => {
		const doc = makeDocument(`<div data-bundle-root></div>`);
		const { swap, events } = createHarness(doc);

		swap(swapInNewMain(doc, `<div data-bundle-root></div>`));

		assert.deepEqual(events, ["create:1", "cleanup:1", "create:2"]);
	});

	it("tears down without re-creating when the arriving <main> lacks the markup", () => {
		const doc = makeDocument(`<div data-bundle-root></div>`);
		const { swap, events } = createHarness(doc);

		swap(swapInNewMain(doc, `<p>a page without this bundle</p>`));

		assert.deepEqual(events, ["create:1", "cleanup:1"]);
	});

	it("creates fresh after a bundle-less page without a stale teardown", () => {
		const doc = makeDocument(`<p>a page without this bundle</p>`);
		const { swap, events } = createHarness(doc);

		swap(swapInNewMain(doc, `<div data-bundle-root></div>`));

		assert.deepEqual(events, ["create:1"]);
	});
});
