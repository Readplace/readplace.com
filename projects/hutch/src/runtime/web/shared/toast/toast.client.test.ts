import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initToastDismiss } from "./toast.client";

interface ScheduledTimer {
	callback: () => void;
	ms: number;
}

function initWithDom(bodyHtml: string): {
	document: Document;
	timers: ScheduledTimer[];
	triggerSwap: () => void;
} {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	const timers: ScheduledTimer[] = [];
	let swapListener: (() => void) | undefined;
	initToastDismiss({
		document: dom.window.document,
		setTimeoutFn: (callback, ms) => {
			timers.push({ callback, ms });
		},
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	});
	return {
		document: dom.window.document,
		timers,
		triggerSwap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
	};
}

describe("initToastDismiss", () => {
	it("fades a toast out, then removes it, after its data-dismiss delay", () => {
		const { document, timers } = initWithDom(
			`<div class="toast" data-dismiss="6000">Saved</div>`,
		);
		const toast = document.querySelector(".toast");
		assert(toast, "toast must render");
		expect(toast.isConnected).toBe(true);
		expect(timers.length).toBe(1);
		expect(timers[0].ms).toBe(6000);

		// The dismiss delay elapses: the toast starts fading but is still present.
		timers[0].callback();
		expect(toast.classList.contains("toast--dismissing")).toBe(true);
		expect(toast.isConnected).toBe(true);

		// The fade-out elapses: the toast is removed.
		expect(timers.length).toBe(2);
		timers[1].callback();
		expect(toast.isConnected).toBe(false);
	});

	it("schedules a toast that is inserted after an htmx swap", () => {
		const { document, timers, triggerSwap } = initWithDom("");
		expect(timers.length).toBe(0);
		document.body.innerHTML = `<div class="toast" data-dismiss="5000">Updated</div>`;
		triggerSwap();
		expect(timers.length).toBe(1);
		expect(timers[0].ms).toBe(5000);
	});

	it("does not reschedule a toast that is already pending dismissal", () => {
		const { timers, triggerSwap } = initWithDom(
			`<div class="toast" data-dismiss="10000">Saved</div>`,
		);
		expect(timers.length).toBe(1);
		triggerSwap();
		expect(timers.length).toBe(1);
	});

	it("ignores elements whose data-dismiss is not a positive number", () => {
		const { timers } = initWithDom(
			`<div class="toast" data-dismiss="abc">bad</div><div class="toast" data-dismiss="0">zero</div>`,
		);
		expect(timers.length).toBe(0);
	});
});
