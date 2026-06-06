import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initHighlights } from "./highlights.client";

interface SetupOptions {
	innerHtml?: string;
	listHtml?: string;
	ready?: boolean;
	withPanel?: boolean;
	withList?: boolean;
	withButton?: boolean;
}

const DEFAULT_ITEM = `<li data-highlight-id="h1" data-highlight-quote="findme">findme</li>`;

function setup(options: SetupOptions = {}) {
	const {
		innerHtml = "<html><body><p>before findme after</p></body></html>",
		listHtml = DEFAULT_ITEM,
		ready = true,
		withPanel = true,
		withList = true,
		withButton = true,
	} = options;

	const panelHtml = withPanel
		? `<div data-highlights data-highlights-create-url="/c">
				${withButton ? `<button data-highlights-add hidden></button>` : ""}
				${withList ? `<ul data-highlights-list>${listHtml}</ul>` : ""}
			</div>`
		: "";

	const dom = new JSDOM(
		`<!doctype html><html><body>${panelHtml}<iframe data-reader-iframe></iframe></body></html>`,
	);
	const doc = dom.window.document;
	const iframe = doc.querySelector("iframe");
	assert(iframe, "iframe fixture must exist");
	const inner = new JSDOM(innerHtml);
	Object.defineProperty(iframe, "contentDocument", {
		value: inner.window.document,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(inner.window.document, "readyState", {
		value: ready ? "complete" : "loading",
		configurable: true,
	});

	let selectionText = "";
	let promptResult: string | null = "a note";
	let postResult: string | null = DEFAULT_ITEM;
	const postCalls: Array<{ quote: string; note: string }> = [];
	const swapListeners: Array<() => void> = [];

	const controller = initHighlights({
		document: doc,
		getSelectionText: () => selectionText,
		promptNote: () => promptResult,
		postHighlight: async (input) => {
			postCalls.push(input);
			return postResult;
		},
		addSwapListener: (listener) => swapListeners.push(listener),
	});

	return {
		dom,
		doc,
		iframe,
		controller,
		postCalls,
		button: () => doc.querySelector<HTMLElement>("[data-highlights-add]"),
		listEl: () => doc.querySelector("[data-highlights-list]"),
		marks: () => Array.from(inner.window.document.querySelectorAll("mark.rp-highlight")),
		setSelection: (text: string) => {
			selectionText = text;
		},
		setPrompt: (value: string | null) => {
			promptResult = value;
		},
		setPostResult: (value: string | null) => {
			postResult = value;
		},
		fireSwap: () => {
			for (const l of swapListeners) l();
		},
		fireMouseUp: () => {
			inner.window.document.dispatchEvent(new dom.window.Event("mouseup"));
		},
		fireLoad: () => {
			iframe.dispatchEvent(new dom.window.Event("load"));
		},
	};
}

describe("initHighlights", () => {
	it("is a no-op (every method safe to call) when the panel is absent", async () => {
		const env = setup({ withPanel: false });
		env.controller.handleSelection();
		await env.controller.addHighlight();
		env.controller.reapply();
		env.controller.stop();
		expect(env.postCalls).toEqual([]);
	});

	it("is a no-op when the list container is absent", () => {
		const env = setup({ withList: false });
		env.controller.reapply();
		expect(env.marks()).toEqual([]);
	});

	it("is a no-op when the add button is absent", () => {
		const env = setup({ withButton: false });
		env.controller.reapply();
		expect(env.marks()).toEqual([]);
	});

	it("paints server-rendered highlights over the iframe text on init", () => {
		const env = setup();
		const marks = env.marks();
		expect(marks).toHaveLength(1);
		expect(marks[0].textContent).toBe("findme");
		expect(marks[0].getAttribute("data-highlight-id")).toBe("h1");
	});

	it("shows the add button when there is a selection and hides it when empty", () => {
		const env = setup();
		env.setSelection("  some text  ");
		env.controller.handleSelection();
		expect(env.button()?.hidden).toBe(false);

		env.setSelection("");
		env.controller.handleSelection();
		expect(env.button()?.hidden).toBe(true);
	});

	it("does not post when there is no pending selection", async () => {
		const env = setup();
		await env.controller.addHighlight();
		expect(env.postCalls).toEqual([]);
	});

	it("does not post when the user cancels the note prompt", async () => {
		const env = setup();
		env.setSelection("hello");
		env.controller.handleSelection();
		env.setPrompt(null);
		await env.controller.addHighlight();
		expect(env.postCalls).toEqual([]);
	});

	it("posts, swaps in the returned list, hides the button and repaints", async () => {
		const env = setup();
		env.setSelection("hello");
		env.controller.handleSelection();
		env.setPrompt("my note");
		env.setPostResult(`<li data-highlight-id="h2" data-highlight-quote="absent">absent</li>`);

		await env.controller.addHighlight();

		expect(env.postCalls).toEqual([{ quote: "hello", note: "my note" }]);
		expect(env.button()?.hidden).toBe(true);
		const newItem = env.listEl()?.querySelector("[data-highlight-id='h2']");
		assert(newItem, "new highlight must appear in the list after posting");
		expect(env.marks()).toEqual([]);
	});

	it("leaves the list untouched when the server rejects the highlight", async () => {
		const env = setup();
		env.setSelection("hello");
		env.controller.handleSelection();
		env.setPostResult(null);

		await env.controller.addHighlight();

		expect(env.postCalls).toHaveLength(1);
		const originalItem = env.listEl()?.querySelector("[data-highlight-id='h1']");
		assert(originalItem, "original highlight must remain in the list after rejection");
	});

	it("reacts to a mouseup inside the iframe", () => {
		const env = setup();
		env.setSelection("picked text");
		env.fireMouseUp();
		expect(env.button()?.hidden).toBe(false);
	});

	it("creates a highlight when the add button is clicked", async () => {
		const env = setup();
		env.setSelection("hello");
		env.controller.handleSelection();
		env.button()?.dispatchEvent(new env.dom.window.Event("click"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(env.postCalls).toEqual([{ quote: "hello", note: "a note" }]);
	});

	it("repaints highlights when an HTMX swap fires", () => {
		const env = setup();
		const item = env.listEl()?.querySelector("[data-highlight-id]");
		assert(item, "seed highlight item must exist");
		item.setAttribute("data-highlight-quote", "after");

		env.fireSwap();

		const marks = env.marks();
		expect(marks).toHaveLength(1);
		expect(marks[0].textContent).toBe("after");
	});

	it("binds selection and repaints once the iframe finishes loading", () => {
		const env = setup({ ready: false });
		env.fireLoad();
		env.setSelection("after-load");
		env.fireMouseUp();
		expect(env.button()?.hidden).toBe(false);
	});

	it("repaints safely when the reader iframe is no longer in the DOM", () => {
		const env = setup();
		expect(env.marks()).toHaveLength(1);
		env.iframe.remove();
		expect(() => env.controller.reapply()).not.toThrow();
	});

	it("becomes inert after stop()", () => {
		const env = setup();
		env.controller.stop();
		env.controller.reapply();
		// The init paint already happened; stop() guards further repaints from throwing.
		expect(() => env.controller.reapply()).not.toThrow();
	});
});
