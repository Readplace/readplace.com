import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initToastDismiss } from "./toast.client";

interface ScheduledTimer {
	callback: () => void;
	ms: number;
}

function initWithDom(
	bodyHtml: string,
	opts: { withRegion?: boolean } = {},
): {
	document: Document;
	timers: ScheduledTimer[];
	triggerSwap: () => void;
} {
	const region = opts.withRegion
		? `<div class="sr-only" id="toast-live-region" role="status" aria-live="polite"></div>`
		: "";
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}${region}</body></html>`);
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

	const toastWithMessage = (message: string, ms = 6000) =>
		`<div class="toast" data-dismiss="${ms}"><span class="toast__message">${message}</span></div>`;

	it("announces a scanned toast by writing its message into the live region only after the settle delay fires", () => {
		const { document, timers } = initWithDom(toastWithMessage("Saved"), {
			withRegion: true,
		});
		const region = document.getElementById("toast-live-region");
		assert(region, "the persistent live region must be present");

		expect(region.textContent).toBe("");
		const settle = timers.find((timer) => timer.ms === 150);
		assert(settle, "a settle timer must be scheduled for the announcement");

		settle.callback();
		expect(region.textContent).toBe("Saved");
	});

	it("clears the live region when the toast is dismissed, so an unchanged region does not keep the last message", () => {
		const { document, timers } = initWithDom(toastWithMessage("Saved"), {
			withRegion: true,
		});
		const region = document.getElementById("toast-live-region");
		assert(region, "the persistent live region must be present");

		const settle = timers.find((timer) => timer.ms === 150);
		assert(settle, "a settle timer must be scheduled");
		settle.callback();
		expect(region.textContent).toBe("Saved");

		const dismissTimer = timers.find((timer) => timer.ms === 6000);
		assert(dismissTimer, "a dismiss timer must be scheduled");
		dismissTimer.callback();
		expect(region.textContent).toBe("");
	});

	it("re-announces a second identical toast after the first was dismissed and cleared", () => {
		const { document, timers, triggerSwap } = initWithDom(toastWithMessage("Saved"), {
			withRegion: true,
		});
		const region = document.getElementById("toast-live-region");
		assert(region, "the persistent live region must be present");

		timers.find((timer) => timer.ms === 150)?.callback();
		timers.find((timer) => timer.ms === 6000)?.callback();
		expect(region.textContent).toBe("");

		document.body.querySelector(".toast")?.remove();
		const before = timers.length;
		document.body.insertAdjacentHTML("afterbegin", toastWithMessage("Saved"));
		triggerSwap();

		const settle = timers.slice(before).find((timer) => timer.ms === 150);
		assert(settle, "the second toast must schedule its own settle timer");
		settle.callback();
		expect(region.textContent).toBe("Saved");
	});

	it("announces a toast that arrives via an htmx swap", () => {
		const { document, timers, triggerSwap } = initWithDom("", { withRegion: true });
		const region = document.getElementById("toast-live-region");
		assert(region, "the persistent live region must be present");

		document.body.insertAdjacentHTML("afterbegin", toastWithMessage("Updated", 5000));
		triggerSwap();

		const settle = timers.find((timer) => timer.ms === 150);
		assert(settle, "the swapped-in toast must schedule a settle timer");
		settle.callback();
		expect(region.textContent).toBe("Updated");
	});

	it("still schedules dismissal, without announcing or throwing, when no live region is present", () => {
		const { timers } = initWithDom(toastWithMessage("Saved"));

		expect(timers.length).toBe(1);
		expect(timers[0].ms).toBe(6000);
		expect(() => timers[0].callback()).not.toThrow();
	});

	it("throws if a scanned toast has no message span to announce, since a well-formed toast always carries one", () => {
		const dom = new JSDOM(
			`<!DOCTYPE html><html><body><div class="toast" data-dismiss="6000"></div><div id="toast-live-region"></div></body></html>`,
		);
		expect(() =>
			initToastDismiss({
				document: dom.window.document,
				setTimeoutFn: () => {},
				addSwapListener: () => {},
			}),
		).toThrow(/toast__message/);
	});
});
