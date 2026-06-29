import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initLocalTime } from "./local-time.client";

const SYDNEY = "Australia/Sydney";

function initWithDom(
	bodyHtml: string,
	timeZone = SYDNEY,
): {
	document: Document;
	triggerSwap: () => void;
} {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	let swapListener: (() => void) | undefined;
	initLocalTime({
		document: dom.window.document,
		timeZone: () => timeZone,
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	}).attach();
	return {
		document: dom.window.document,
		triggerSwap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
	};
}

describe("initLocalTime", () => {
	it("rewrites a datetime element into the browser zone with the abbreviation", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="datetime">Jun 24, 2026, 09:00 UTC</time>`,
		);
		expect(document.querySelector("time")?.textContent).toBe(
			"Jun 24, 2026, 19:00 GMT+10",
		);
	});

	it("rewrites a date element into the browser zone, fixing midnight ±1-day drift", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-23T15:00:00.000Z" data-local-time="date">Jun 23, 2026</time>`,
		);
		expect(document.querySelector("time")?.textContent).toBe("Jun 24, 2026");
	});

	it("leaves relative text in place and only sets the localised absolute instant as a title", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="relative">5m ago</time>`,
		);
		const el = document.querySelector("time");
		assert(el, "time element must render");
		expect(el.textContent).toBe("5m ago");
		expect(el.getAttribute("title")).toBe("Jun 24, 2026, 19:00 GMT+10");
	});

	it("skips an element with a missing or unparseable datetime", () => {
		const { document } = initWithDom(
			`<time data-local-time="datetime">no datetime</time><time datetime="not-a-date" data-local-time="datetime">bad</time>`,
		);
		const [missing, unparseable] = Array.from(document.querySelectorAll("time"));
		expect(missing.textContent).toBe("no datetime");
		expect(unparseable.textContent).toBe("bad");
	});

	it("re-localises elements inserted after an htmx swap", () => {
		const { document, triggerSwap } = initWithDom("");
		document.body.innerHTML = `<time datetime="2026-06-24T09:00:00.000Z" data-local-time="datetime">Jun 24, 2026, 09:00 UTC</time>`;
		triggerSwap();
		expect(document.querySelector("time")?.textContent).toBe(
			"Jun 24, 2026, 19:00 GMT+10",
		);
	});
});
