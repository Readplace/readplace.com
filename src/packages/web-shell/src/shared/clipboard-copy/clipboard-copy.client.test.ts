import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { initClipboardCopy } from "./clipboard-copy.client";

const TEXT = "https://readplace.com/mcp";
const COPY_SELECTOR = "[data-copy]";
const TEXT_ATTR = "data-copy-text";

interface NavigatorStub {
	clipboard?: { writeText(text: string): Promise<void> };
}

function buildDom(options: { malformed?: boolean } = {}): Document {
	const malformed = options.malformed
		? `<button type="button" data-copy hidden>Copy</button>`
		: "";
	const dom = new JSDOM(`<!DOCTYPE html><html><body>
		<code>${TEXT}</code>
		<button type="button" data-copy data-copy-text="${TEXT}" hidden>Copy</button>
		${malformed}
	</body></html>`);
	return dom.window.document;
}

function setup(options: { navigator?: NavigatorStub; malformed?: boolean } = {}) {
	const document = buildDom({ malformed: options.malformed });
	const navigator: NavigatorStub = options.navigator ?? {
		clipboard: { writeText: jest.fn(() => Promise.resolve()) },
	};
	const ctrl = initClipboardCopy({
		document,
		navigator,
		setTimeoutFn: setTimeout,
		clearTimeoutFn: clearTimeout,
		copySelector: COPY_SELECTOR,
		textAttr: TEXT_ATTR,
	});
	return { document, navigator, ctrl };
}

function copyButton(doc: Document): HTMLButtonElement {
	const btn = doc.querySelector<HTMLButtonElement>(`[data-copy][${TEXT_ATTR}]`);
	assert(btn, "well-formed copy button must exist in fixture");
	return btn;
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe("initClipboardCopy", () => {
	it("leaves the copy button hidden when the clipboard API is unavailable", () => {
		const { document, ctrl } = setup({ navigator: {} });

		ctrl.attach();

		expect(copyButton(document).hidden).toBe(true);
	});

	it("reveals the copy button and copies the text on click, flashing then restoring the label", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		ctrl.attach();
		const btn = copyButton(document);
		expect(btn.hidden).toBe(false);

		fireEvent.click(btn);
		expect(writeText).toHaveBeenCalledWith(TEXT);

		await flushPromises();
		expect(btn.textContent).toBe("Copied");

		jest.advanceTimersByTime(2000);
		expect(btn.textContent).toBe("Copy");
	});

	it("shows a manual-copy hint when writeText rejects", async () => {
		const writeText = jest.fn(() => Promise.reject(new Error("denied")));
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		ctrl.attach();
		const btn = copyButton(document);

		fireEvent.click(btn);
		await flushPromises();

		expect(btn.textContent).toBe("Press Ctrl+C");
	});

	it("holds the copied label for a full window across two clicks, then restores the original", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		ctrl.attach();
		const btn = copyButton(document);

		fireEvent.click(btn);
		await flushPromises();
		expect(btn.textContent).toBe("Copied");

		jest.advanceTimersByTime(1000);
		fireEvent.click(btn);
		await flushPromises();
		expect(btn.textContent).toBe("Copied");

		// The first click's reset was cancelled by the second flash, so the label
		// must still read "Copied" at the point the first timer would have fired.
		jest.advanceTimersByTime(1000);
		expect(btn.textContent).toBe("Copied");

		// Only the second flash's timer restores the original, a full window later.
		jest.advanceTimersByTime(1000);
		expect(btn.textContent).toBe("Copy");
	});

	it("skips a malformed copy button that carries no text attribute", () => {
		const { document, ctrl } = setup({ malformed: true });

		ctrl.attach();

		const malformed = document.querySelector(`[data-copy]:not([${TEXT_ATTR}])`);
		expect(malformed?.hasAttribute("hidden")).toBe(true);
	});
});
