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
	triggerBeforeRequest: () => void;
	triggerAfterSettle: () => void;
	setActiveElement: (element: Element | null) => void;
} {
	const region = opts.withRegion
		? `<div class="sr-only" id="toast-live-region" role="status" aria-live="polite"></div>`
		: "";
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}${region}</body></html>`);
	const document = dom.window.document;
	const timers: ScheduledTimer[] = [];
	let swapListener: (() => void) | undefined;
	let beforeRequestListener: (() => void) | undefined;
	let afterSettleListener: (() => void) | undefined;
	initToastDismiss({
		document,
		setTimeoutFn: (callback, ms) => {
			timers.push({ callback, ms });
		},
		addSwapListener: (listener) => {
			swapListener = listener;
		},
		addBeforeRequestListener: (listener) => {
			beforeRequestListener = listener;
		},
		addAfterSettleListener: (listener) => {
			afterSettleListener = listener;
		},
	});
	return {
		document,
		timers,
		triggerSwap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
		triggerBeforeRequest: () => {
			assert(beforeRequestListener, "a beforeRequest listener must be registered");
			beforeRequestListener();
		},
		triggerAfterSettle: () => {
			assert(afterSettleListener, "an afterSettle listener must be registered");
			afterSettleListener();
		},
		// JSDOM computes activeElement from real focus() side effects; the injected
		// deps let a test state it directly instead, keeping those quirks out.
		setActiveElement: (element) => {
			Object.defineProperty(document, "activeElement", {
				value: element,
				configurable: true,
			});
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
				addBeforeRequestListener: () => {},
				addAfterSettleListener: () => {},
			}),
		).toThrow(/toast__message/);
	});

	it("returns focus to the acted-on control after the swap settles", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(
				`<button id="inbox-card-0001-save">Save</button><div class="toast" data-dismiss="6000" tabindex="-1">Adding…</div>`,
			);
		const button = document.getElementById("inbox-card-0001-save");
		assert(button, "the save button must render");
		const focusSpy = jest.spyOn(button, "focus");

		// The reader has the Save button focused when the request fires.
		setActiveElement(button);
		triggerBeforeRequest();
		// hx-disabled-elt has since blurred the button to <body>; focus must come
		// back to the same-id button carried in the swapped markup.
		setActiveElement(document.body);
		triggerAfterSettle();

		expect(focusSpy).toHaveBeenCalledTimes(1);
	});

	it("treats focus resting on the document element as dropped and restores it", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(`<button id="inbox-card-0002-save">Save</button>`);
		const button = document.getElementById("inbox-card-0002-save");
		assert(button, "the save button must render");
		const focusSpy = jest.spyOn(button, "focus");

		setActiveElement(button);
		triggerBeforeRequest();
		setActiveElement(document.documentElement);
		triggerAfterSettle();

		expect(focusSpy).toHaveBeenCalledTimes(1);
	});

	it("focuses the newest toast when the acted-on control did not survive the swap", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(
				`<button id="inbox-card-0003-save">Save</button><div class="toast" data-dismiss="6000" tabindex="-1">Adding…</div>`,
			);
		const button = document.getElementById("inbox-card-0003-save");
		const toast = document.querySelector<HTMLElement>(".toast");
		assert(button && toast, "the button and toast must render");
		const toastFocusSpy = jest.spyOn(toast, "focus");

		setActiveElement(button);
		triggerBeforeRequest();
		// The swap replaced the markup without this control.
		button.remove();
		setActiveElement(document.body);
		triggerAfterSettle();

		expect(toastFocusSpy).toHaveBeenCalledTimes(1);
	});

	it("restores nothing when neither the control nor a toast survives the swap", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(`<button id="inbox-card-0004-save">Save</button>`);
		const button = document.getElementById("inbox-card-0004-save");
		assert(button, "the save button must render");
		const focusSpy = jest.spyOn(button, "focus");

		setActiveElement(button);
		triggerBeforeRequest();
		button.remove();
		setActiveElement(document.body);
		// No control and no toast to fall back to: the swap simply leaves focus be.
		triggerAfterSettle();

		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("leaves focus where the reader moved it during the request", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(
				`<button id="inbox-card-0005-save">Save</button><a id="elsewhere" href="#">Back</a>`,
			);
		const button = document.getElementById("inbox-card-0005-save");
		const elsewhere = document.getElementById("elsewhere");
		assert(button && elsewhere, "both controls must render");
		const focusSpy = jest.spyOn(button, "focus");

		setActiveElement(button);
		triggerBeforeRequest();
		// The reader tabbed away before the swap settled.
		setActiveElement(elsewhere);
		triggerAfterSettle();

		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("restores no focus when the request came from a control with no id", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(`<button class="no-id">Save</button>`);
		const button = document.querySelector<HTMLButtonElement>(".no-id");
		assert(button, "the button must render");
		const focusSpy = jest.spyOn(button, "focus");

		setActiveElement(button);
		triggerBeforeRequest();
		setActiveElement(document.body);
		triggerAfterSettle();

		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("records nothing to restore when the document has no active element", () => {
		const { document, triggerBeforeRequest, triggerAfterSettle, setActiveElement } =
			initWithDom(`<button id="inbox-card-0006-save">Save</button>`);
		const button = document.getElementById("inbox-card-0006-save");
		assert(button, "the save button must render");
		const focusSpy = jest.spyOn(button, "focus");

		setActiveElement(null);
		triggerBeforeRequest();
		setActiveElement(document.body);
		triggerAfterSettle();

		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("hands focus back to the recorded control when the toast self-dismisses under focus", () => {
		const { document, timers, triggerBeforeRequest, setActiveElement } = initWithDom(
			`<button id="inbox-card-0007-save">Save</button><div class="toast" data-dismiss="6000" tabindex="-1">Adding…</div>`,
		);
		const button = document.getElementById("inbox-card-0007-save");
		const toast = document.querySelector<HTMLElement>(".toast");
		assert(button && toast, "the button and toast must render");
		const focusSpy = jest.spyOn(button, "focus");

		// The action recorded the button; the reader's focus is now parked on the
		// toast when its dismiss timer fires.
		setActiveElement(button);
		triggerBeforeRequest();
		setActiveElement(toast);
		const dismissTimer = timers.find((timer) => timer.ms === 6000);
		assert(dismissTimer, "the toast must have scheduled its dismissal");
		dismissTimer.callback();

		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(toast.classList.contains("toast--dismissing")).toBe(true);
	});

	it("removes the toast without error when it self-dismisses under focus and the control is gone", () => {
		const { document, timers, triggerBeforeRequest, setActiveElement } = initWithDom(
			`<button id="inbox-card-0008-save">Save</button><div class="toast" data-dismiss="6000" tabindex="-1">Adding…</div>`,
		);
		const button = document.getElementById("inbox-card-0008-save");
		const toast = document.querySelector<HTMLElement>(".toast");
		assert(button && toast, "the button and toast must render");

		setActiveElement(button);
		triggerBeforeRequest();
		button.remove();
		setActiveElement(toast);
		const dismissTimer = timers.find((timer) => timer.ms === 6000);
		assert(dismissTimer, "the toast must have scheduled its dismissal");
		dismissTimer.callback();

		expect(toast.classList.contains("toast--dismissing")).toBe(true);
	});
});
