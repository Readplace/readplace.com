import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReaderIframes, measureContentHeight } from "./reader-iframe.client";

interface FakeObserverCtor {
	new (cb: () => void): { observe(): void; disconnect(): void };
}

interface FakeObserverFactory {
	Ctor: FakeObserverCtor;
	trigger(): void;
}

function makeObserverFactory(): FakeObserverFactory {
	const callbacks: Array<() => void> = [];
	class FakeObserver {
		private readonly cb: () => void;
		constructor(cb: () => void) {
			this.cb = cb;
			callbacks.push(cb);
		}
		observe(): void {}
		disconnect(): void {
			const idx = callbacks.indexOf(this.cb);
			if (idx >= 0) callbacks.splice(idx, 1);
		}
	}
	return {
		Ctor: FakeObserver as unknown as FakeObserverCtor,
		trigger() {
			for (const cb of callbacks.slice()) cb();
		},
	};
}

function makePage(iframeHtml: string) {
	const dom = new JSDOM(
		`<!doctype html><html><body>${iframeHtml}</body></html>`,
	);
	return dom;
}

function makeReadyIframe(dom: JSDOM, srcdoc: string): HTMLIFrameElement {
	const iframe = dom.window.document.querySelector("iframe");
	assert(iframe, "iframe must be present");
	const inner = new JSDOM(srcdoc);
	const innerDoc = inner.window.document;
	Object.defineProperty(iframe, "contentDocument", {
		value: innerDoc,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(innerDoc, "readyState", {
		value: "complete",
		configurable: true,
	});
	return iframe;
}

function defineScrollHeights(doc: Document, html: number, body: number): void {
	Object.defineProperty(doc.documentElement, "scrollHeight", {
		value: html,
		configurable: true,
	});
	Object.defineProperty(doc.body, "scrollHeight", {
		value: body,
		configurable: true,
	});
}

describe("measureContentHeight", () => {
	it("returns the larger of documentElement.scrollHeight and body.scrollHeight", () => {
		const dom = new JSDOM("<!doctype html><html><body></body></html>");
		const doc = dom.window.document;
		defineScrollHeights(doc, 800, 1200);

		expect(measureContentHeight(doc)).toBe(1200);
	});

	it("ceils a sub-pixel height so a 0.5px scrollbar does not appear", () => {
		const dom = new JSDOM("<!doctype html><html><body></body></html>");
		const doc = dom.window.document;
		defineScrollHeights(doc, 800.5, 800.5);

		expect(measureContentHeight(doc)).toBe(801);
	});
});

describe("initReaderIframes", () => {
	function setup(srcdoc: string) {
		const dom = makePage(
			`<iframe data-reader-iframe class="article-body__reader-iframe"></iframe>`,
		);
		const iframe = makeReadyIframe(dom, srcdoc);
		const swapListeners: Array<() => void> = [];
		const resizeObservers = makeObserverFactory();
		const mutationObservers = makeObserverFactory();
		const controller = initReaderIframes({
			document: dom.window.document,
			ResizeObserver: resizeObservers.Ctor,
			MutationObserver: mutationObservers.Ctor,
			addSwapListener: (listener) => swapListeners.push(listener),
		});
		return {
			dom,
			iframe,
			controller,
			fireSwap() {
				for (const l of swapListeners) l();
			},
			resizeObservers,
			mutationObservers,
		};
	}

	it("sets the iframe height to its content scrollHeight on initial scan", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 720, 720);

		env.controller.scan();

		expect(env.iframe.style.height).toBe("720px");
		env.controller.stop();
	});

	it("re-measures when the inner document's ResizeObserver fires", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 400, 400);

		env.controller.scan();
		expect(env.iframe.style.height).toBe("400px");

		defineScrollHeights(doc, 900, 900);
		env.resizeObservers.trigger();
		expect(env.iframe.style.height).toBe("900px");

		env.controller.stop();
	});

	it("re-measures when the inner document's MutationObserver fires", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 400, 400);

		env.controller.scan();
		defineScrollHeights(doc, 1100, 1100);
		env.mutationObservers.trigger();

		expect(env.iframe.style.height).toBe("1100px");
		env.controller.stop();
	});

	it("re-measures when an image inside the iframe finishes loading", () => {
		const env = setup(
			`<html><body><img src="https://example.com/x.png"></body></html>`,
		);
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		const image = doc.querySelector("img");
		assert(image, "image must be present in fixture srcdoc");
		Object.defineProperty(image, "complete", {
			value: false,
			configurable: true,
		});
		defineScrollHeights(doc, 200, 200);

		env.controller.scan();
		expect(env.iframe.style.height).toBe("200px");

		defineScrollHeights(doc, 850, 850);
		image.dispatchEvent(new env.dom.window.Event("load"));
		expect(env.iframe.style.height).toBe("850px");

		env.controller.stop();
	});

	it("re-measures when an image inside the iframe fails to load", () => {
		const env = setup(
			`<html><body><img src="https://example.com/x.png"></body></html>`,
		);
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		const image = doc.querySelector("img");
		assert(image, "image must be present in fixture srcdoc");
		Object.defineProperty(image, "complete", {
			value: false,
			configurable: true,
		});
		defineScrollHeights(doc, 200, 200);

		env.controller.scan();
		defineScrollHeights(doc, 600, 600);
		image.dispatchEvent(new env.dom.window.Event("error"));

		expect(env.iframe.style.height).toBe("600px");
		env.controller.stop();
	});

	it("skips images that have already loaded by the time the scan runs", () => {
		const env = setup(
			`<html><body><img src="https://example.com/x.png"></body></html>`,
		);
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		const image = doc.querySelector("img");
		assert(image, "image must be present in fixture srcdoc");
		Object.defineProperty(image, "complete", {
			value: true,
			configurable: true,
		});
		defineScrollHeights(doc, 500, 500);

		env.controller.scan();
		expect(env.iframe.style.height).toBe("500px");
		env.controller.stop();
	});

	it("re-binds when an HTMX swap replaces the iframe element", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 300, 300);

		env.controller.scan();
		expect(env.iframe.style.height).toBe("300px");

		const parent = env.iframe.parentElement;
		assert(parent, "iframe must have a parent");
		parent.removeChild(env.iframe);
		const replacement = env.dom.window.document.createElement("iframe");
		replacement.setAttribute("data-reader-iframe", "");
		parent.appendChild(replacement);
		const replacementInner = new JSDOM(
			"<html><body><p>Swapped</p></body></html>",
		);
		const replacementDoc = replacementInner.window.document;
		Object.defineProperty(replacement, "contentDocument", {
			value: replacementDoc,
			configurable: true,
		});
		Object.defineProperty(replacementDoc, "readyState", {
			value: "complete",
			configurable: true,
		});
		defineScrollHeights(replacementDoc, 950, 950);

		env.fireSwap();

		expect(replacement.style.height).toBe("950px");
		env.controller.stop();
	});

	it("unbinds observers from iframes that are removed before the swap", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 200, 200);

		env.controller.scan();

		const parent = env.iframe.parentElement;
		assert(parent, "iframe must have a parent");
		parent.removeChild(env.iframe);
		env.fireSwap();

		defineScrollHeights(doc, 800, 800);
		env.resizeObservers.trigger();
		expect(env.iframe.style.height).toBe("200px");
		env.controller.stop();
	});

	it("does nothing on scan after stop is called", () => {
		const env = setup("<html><body><p>Body</p></body></html>");
		const doc = env.iframe.contentDocument;
		assert(doc, "contentDocument must exist");
		defineScrollHeights(doc, 200, 200);

		env.controller.scan();
		env.controller.stop();

		defineScrollHeights(doc, 999, 999);
		env.controller.scan();
		expect(env.iframe.style.height).toBe("200px");
	});

	it("waits for the iframe load event when the inner document is not yet complete", () => {
		const dom = makePage(
			`<iframe data-reader-iframe class="article-body__reader-iframe"></iframe>`,
		);
		const iframe = dom.window.document.querySelector("iframe");
		assert(iframe, "iframe must be present");
		const inner = new JSDOM("<html><body><p>Body</p></body></html>");
		const innerDoc = inner.window.document;
		Object.defineProperty(iframe, "contentDocument", {
			value: innerDoc,
			configurable: true,
		});
		Object.defineProperty(innerDoc, "readyState", {
			value: "loading",
			configurable: true,
		});
		defineScrollHeights(innerDoc, 333, 333);

		const swapListeners: Array<() => void> = [];
		const resizeObservers = makeObserverFactory();
		const mutationObservers = makeObserverFactory();
		const controller = initReaderIframes({
			document: dom.window.document,
			ResizeObserver: resizeObservers.Ctor,
			MutationObserver: mutationObservers.Ctor,
			addSwapListener: (listener) => swapListeners.push(listener),
		});

		// Height not yet set — load event has not fired.
		expect(iframe.style.height).toBe("");

		iframe.dispatchEvent(new dom.window.Event("load"));
		expect(iframe.style.height).toBe("333px");

		controller.stop();
	});
});
