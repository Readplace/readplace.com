import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { initShareBalloon } from "./share-balloon.client";

const OPEN_CLASS = "share-balloon__wrap--open";
const COPIED_VISIBLE_CLASS = "share-balloon__copied--visible";
const STORAGE_KEY = "readplace.share-dismissed";
const ARTICLE_URL_SHARE = "https://example.com/post?utm_medium=share";
const ARTICLE_URL_COPY = "https://example.com/post?utm_medium=copy";
const ARTICLE_TITLE = "Hello World";

type ReaderStatus = "ready" | "pending" | "failed" | "unsupported";

function buildFixture(
	options: { readerStatus?: ReaderStatus | "absent" } = {},
): string {
	const readerStatus = options.readerStatus ?? "absent";
	const readerSlot =
		readerStatus === "absent"
			? ""
			: `<div data-test-reader-slot data-reader-status="${readerStatus}"></div>`;
	return `<!DOCTYPE html><html><body>
<span data-share-balloon-status></span>
<div data-article-body></div>
${readerSlot}
<div data-share-balloon-wrap hidden>
  <div data-share-balloon-buttons>
    <div data-share-balloon-chat></div>
    <button type="button" data-share-balloon-copy data-share-url="${ARTICLE_URL_COPY}"></button>
    <button type="button" data-share-balloon data-share-url="${ARTICLE_URL_SHARE}" data-share-title="${ARTICLE_TITLE}"></button>
  </div>
  <button type="button" data-share-balloon-close></button>
  <span data-share-balloon-copied>Link copied!</span>
</div>
</body></html>`;
}

interface NavigatorStub {
	share?: (data: { title: string; url: string }) => Promise<void>;
	clipboard?: { writeText(text: string): Promise<void> };
}

type TestWindow = ReturnType<typeof createDom>["window"];

function createDom(
	options: { readerStatus?: ReaderStatus | "absent" } = {},
) {
	const dom = new JSDOM(buildFixture(options), { url: "https://readplace.com/" });
	return { window: dom.window, document: dom.window.document };
}

function setScrollY(win: TestWindow, value: number): void {
	Object.defineProperty(win, "scrollY", {
		value,
		writable: true,
		configurable: true,
	});
}

function setArticleHeight(doc: Document, value: number): void {
	const el = element(doc, "[data-article-body]");
	Object.defineProperty(el, "offsetHeight", {
		value,
		writable: true,
		configurable: true,
	});
}

function fireScroll(win: TestWindow): void {
	win.dispatchEvent(new win.Event("scroll"));
}

function setup(
	options: {
		scrollY?: number;
		dismissed?: boolean;
		navigator?: NavigatorStub;
		articleHeight?: number;
		readerStatus?: ReaderStatus | "absent";
	} = {},
) {
	const { window, document } = createDom({ readerStatus: options.readerStatus });
	setScrollY(window, options.scrollY ?? 0);
	setArticleHeight(document, options.articleHeight ?? 4000);
	if (options.dismissed) {
		window.localStorage.setItem(STORAGE_KEY, "1");
	}
	const navigator: NavigatorStub = options.navigator ?? {
		share: jest.fn(() => Promise.resolve()),
	};
	const ctrl = initShareBalloon({
		window,
		document,
		storage: window.localStorage,
		navigator,
		setTimeoutFn: setTimeout,
		clearTimeoutFn: clearTimeout,
	});
	return { window, document, ctrl, navigator };
}

function element(doc: Document, selector: string): HTMLElement {
	const el = doc.querySelector<HTMLElement>(selector);
	assert(el, `${selector} must exist in fixture`);
	return el;
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe("initShareBalloon — attach/dismiss flow", () => {
	it("does not open after a scroll when the dismiss flag is already set", () => {
		const { window, document, ctrl } = setup({ dismissed: true });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 2500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("unhides the wrap on attach when capabilities are available", () => {
		const { document, ctrl } = setup();
		const wrap = element(document, "[data-share-balloon-wrap]");
		expect(wrap.hasAttribute("hidden")).toBe(true);

		ctrl.attach();

		expect(wrap.hasAttribute("hidden")).toBe(false);
	});

	it("is a no-op when neither navigator.share nor navigator.clipboard is available", () => {
		const { window, document, ctrl } = setup({ navigator: {} });
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		setScrollY(window, 2500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.hasAttribute("hidden")).toBe(true);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("ignores a second attach() call on the same controller", () => {
		const { window, document, ctrl } = setup();
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		ctrl.attach();
		setScrollY(window, 2500);
		fireScroll(window);
		jest.advanceTimersByTime(1000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});
});

describe("initShareBalloon — reader-slot gating (article loading or errored)", () => {
	it("does not open after scrolling past the threshold while the reader-slot status is pending", () => {
		const { window, document, ctrl } = setup({
			articleHeight: 2000,
			readerStatus: "pending",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 1500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("does not open when the page was already scrolled past the threshold on attach but the reader-slot is pending", () => {
		const { document, ctrl } = setup({
			articleHeight: 2000,
			scrollY: 1500,
			readerStatus: "pending",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("does not open while the reader-slot reports a failed crawl", () => {
		const { window, document, ctrl } = setup({
			articleHeight: 2000,
			readerStatus: "failed",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 1500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("does not open while the reader-slot reports an unsupported crawl", () => {
		const { window, document, ctrl } = setup({
			articleHeight: 2000,
			readerStatus: "unsupported",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 1500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("still unhides the wrap so the share and copy buttons remain reachable while the article is loading", () => {
		const { document, ctrl } = setup({ readerStatus: "pending" });
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();

		expect(wrap.hasAttribute("hidden")).toBe(false);
	});

	it("still wires the copy button so the buttons keep working without the balloon", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({
			readerStatus: "pending",
			navigator: { clipboard: { writeText } },
		});
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));

		expect(writeText).toHaveBeenCalledWith(ARTICLE_URL_COPY);
	});

	it("opens after the reader-slot flips to ready via htmx:afterSwap, even without another scroll event", () => {
		const { window, document, ctrl } = setup({
			articleHeight: 2000,
			scrollY: 1500,
			readerStatus: "pending",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();
		jest.advanceTimersByTime(5000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);

		element(document, "[data-test-reader-slot]").setAttribute(
			"data-reader-status",
			"ready",
		);
		document.dispatchEvent(new window.Event("htmx:afterSwap"));
		jest.advanceTimersByTime(1000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("ignores htmx:afterSwap once the balloon has been dismissed", () => {
		const { window, document, ctrl } = setup({
			articleHeight: 2000,
			scrollY: 1500,
			readerStatus: "pending",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();
		fireEvent.click(element(document, "[data-share-balloon-close]"));

		element(document, "[data-test-reader-slot]").setAttribute(
			"data-reader-status",
			"ready",
		);
		document.dispatchEvent(new window.Event("htmx:afterSwap"));
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("opens when the reader-slot is already ready at attach time and the user has scrolled", () => {
		const { document, ctrl } = setup({
			articleHeight: 2000,
			scrollY: 1500,
			readerStatus: "ready",
		});
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		jest.advanceTimersByTime(1000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});
});

describe("initShareBalloon — scroll-to-open", () => {
	it("does not auto-open at attach time when the user has not scrolled", () => {
		const { document, ctrl } = setup({
			articleHeight: 600,
			scrollY: 0,
		});
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("does not open while scrollY is below half the article height", () => {
		const { window, document, ctrl } = setup({ articleHeight: 2000 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 999);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("opens one OPEN_DELAY_MS after scrollY crosses half the article height", () => {
		const { window, document, ctrl } = setup({ articleHeight: 2000 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 1000);
		fireScroll(window);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
		jest.advanceTimersByTime(999);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
		jest.advanceTimersByTime(1);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("does not schedule a second open if another scroll fires after the threshold was crossed", () => {
		const { window, document, ctrl } = setup({ articleHeight: 2000 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 1000);
		fireScroll(window);
		jest.advanceTimersByTime(1000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);

		wrap.classList.remove(OPEN_CLASS);
		fireScroll(window);
		jest.advanceTimersByTime(5000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("honours an already-scrolled page on attach (synchronous open scheduling)", () => {
		const { document, ctrl } = setup({
			articleHeight: 2000,
			scrollY: 1500,
		});
		const wrap = element(document, "[data-share-balloon-wrap]");

		ctrl.attach();
		jest.advanceTimersByTime(1000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("re-reads the article height on each scroll so dynamic-height content recomputes the threshold", () => {
		const { window, document, ctrl } = setup({ articleHeight: 2000 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		setScrollY(window, 500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);

		setArticleHeight(document, 200);
		fireScroll(window);
		jest.advanceTimersByTime(1000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});
});

describe("initShareBalloon — close button", () => {
	it("removes the open class and persists the dismiss flag in storage", () => {
		const { window, document, ctrl } = setup({ scrollY: 2500 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();
		jest.advanceTimersByTime(1000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);

		fireEvent.click(element(document, "[data-share-balloon-close]"));

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("cancels a pending open timer when closed before OPEN_DELAY_MS elapses", () => {
		const { document, ctrl } = setup({ scrollY: 2500 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-close]"));
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("stops scroll from opening the wrap after dismissal", () => {
		const { window, document, ctrl } = setup();
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-close]"));
		setScrollY(window, 2500);
		fireScroll(window);
		jest.advanceTimersByTime(5000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("stops event propagation so the wrap click listeners do not fire", () => {
		const { document, ctrl } = setup();
		const wrap = element(document, "[data-share-balloon-wrap]");
		const bubbled = jest.fn();
		wrap.addEventListener("click", bubbled);
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-close]"));

		expect(bubbled).not.toHaveBeenCalled();
	});
});

describe("initShareBalloon — share click", () => {
	it("calls navigator.share with the title and url from the data attributes", () => {
		const share = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { share } });
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon]"));

		expect(share).toHaveBeenCalledWith({
			title: ARTICLE_TITLE,
			url: ARTICLE_URL_SHARE,
		});
	});

	it("swallows AbortError from navigator.share", async () => {
		const abortError = Object.assign(new Error("abort"), { name: "AbortError" });
		const share = jest.fn(() => Promise.reject(abortError));
		const { document, ctrl } = setup({ navigator: { share } });
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon]"));

		await expect(flushPromises()).resolves.toBeUndefined();
	});

	it("also swallows non-AbortError rejections from navigator.share", async () => {
		const share = jest.fn(() => Promise.reject(new Error("no dice")));
		const { document, ctrl } = setup({ navigator: { share } });
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon]"));

		await expect(flushPromises()).resolves.toBeUndefined();
	});

	it("does not copy to the clipboard when only the share button is clicked", () => {
		const writeText = jest.fn(() => Promise.resolve());
		const share = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({
			navigator: { clipboard: { writeText }, share },
		});
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon]"));

		expect(share).toHaveBeenCalledTimes(1);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("hides the share button when navigator.share is unavailable", () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		ctrl.attach();

		const btn = element(document, "[data-share-balloon]");
		expect(btn.hasAttribute("hidden")).toBe(true);
	});
});

describe("initShareBalloon — copy click", () => {
	it("copies the data-share-url to the clipboard and flashes the copied feedback", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		const copiedLabel = element(document, "[data-share-balloon-copied]");
		const status = element(document, "[data-share-balloon-status]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));
		expect(writeText).toHaveBeenCalledWith(ARTICLE_URL_COPY);

		await flushPromises();
		expect(copiedLabel.classList.contains(COPIED_VISIBLE_CLASS)).toBe(true);
		expect(status.textContent).toBe("Link copied to clipboard");
	});

	it("fades the copied feedback out after COPIED_FADE_MS", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		const copiedLabel = element(document, "[data-share-balloon-copied]");
		const status = element(document, "[data-share-balloon-status]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));
		await flushPromises();
		jest.advanceTimersByTime(3000);

		expect(copiedLabel.classList.contains(COPIED_VISIBLE_CLASS)).toBe(false);
		expect(status.textContent).toBe("");
	});

	it("reports 'Unable to copy link' to the status region when writeText rejects", async () => {
		const writeText = jest.fn(() => Promise.reject(new Error("denied")));
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		const status = element(document, "[data-share-balloon-status]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));
		await flushPromises();

		expect(status.textContent).toBe("Unable to copy link");
	});

	it("does not call navigator.share when only the copy button is clicked", () => {
		const writeText = jest.fn(() => Promise.resolve());
		const share = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({
			navigator: { clipboard: { writeText }, share },
		});
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(share).not.toHaveBeenCalled();
	});

	it("is a no-op when navigator.clipboard is unavailable (share-only environment)", () => {
		const share = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { share } });
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));

		expect(share).not.toHaveBeenCalled();
	});

	it("removes the copy listener on detach so subsequent clicks do not fire", () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		ctrl.attach();
		ctrl.detach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));

		expect(writeText).not.toHaveBeenCalled();
	});
});

describe("initShareBalloon — storage failures", () => {
	it("treats a throwing getItem as not dismissed", () => {
		const { window, document } = setup({ scrollY: 2500 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		const storage = {
			getItem: jest.fn((): string | null => {
				throw new Error("access denied");
			}),
			setItem: jest.fn(),
		};

		initShareBalloon({
			window,
			document,
			storage,
			navigator: { share: jest.fn(() => Promise.resolve()) },
			setTimeoutFn: setTimeout,
			clearTimeoutFn: clearTimeout,
		}).attach();
		jest.advanceTimersByTime(1000);

		expect(wrap.classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("swallows a throwing setItem when the user dismisses", () => {
		const { window, document } = setup();
		const storage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};

		const ctrl = initShareBalloon({
			window,
			document,
			storage,
			navigator: { share: jest.fn(() => Promise.resolve()) },
			setTimeoutFn: setTimeout,
			clearTimeoutFn: clearTimeout,
		});
		ctrl.attach();

		expect(() =>
			fireEvent.click(element(document, "[data-share-balloon-close]")),
		).not.toThrow();
	});
});

describe("initShareBalloon — detach()", () => {
	it("cancels a pending open timer and stops later scrolls from opening", () => {
		const { window, document, ctrl } = setup({ scrollY: 2500 });
		const wrap = element(document, "[data-share-balloon-wrap]");
		ctrl.attach();

		ctrl.detach();
		jest.advanceTimersByTime(5000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);

		setScrollY(window, 3000);
		fireScroll(window);
		jest.advanceTimersByTime(1000);
		expect(wrap.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("is a no-op when called before attach()", () => {
		const { ctrl } = setup();
		expect(() => ctrl.detach()).not.toThrow();
	});

	it("cancels a pending fade timer after a copy click", async () => {
		const writeText = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { clipboard: { writeText } } });
		const copiedLabel = element(document, "[data-share-balloon-copied]");
		ctrl.attach();

		fireEvent.click(element(document, "[data-share-balloon-copy]"));
		await flushPromises();
		expect(copiedLabel.classList.contains(COPIED_VISIBLE_CLASS)).toBe(true);

		ctrl.detach();
		jest.advanceTimersByTime(5000);
		expect(copiedLabel.classList.contains(COPIED_VISIBLE_CLASS)).toBe(true);
	});

	it("prevents subsequent share clicks from firing handlers", () => {
		const share = jest.fn(() => Promise.resolve());
		const { document, ctrl } = setup({ navigator: { share } });
		ctrl.attach();
		ctrl.detach();

		fireEvent.click(element(document, "[data-share-balloon]"));

		expect(share).not.toHaveBeenCalled();
	});
});
