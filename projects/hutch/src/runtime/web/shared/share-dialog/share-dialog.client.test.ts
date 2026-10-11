import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initShareDialog } from "./share-dialog.client";
import { renderShareDialog, renderSharePanel } from "./share-dialog.component";

const ARTICLE = {
	shareUrl: "https://readplace.com/view/example.com/post",
	title: "Why readers keep tabs open",
	campaign: "reader-internal",
} as const;

const COPIED_LINK =
	"https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=copy&utm_campaign=reader-internal";

const DIALOG = '[data-test-confirm-popover="share"]';
const FALLBACK = "[data-test-share-fallback]";

interface FakeClipboard {
	writes: string[];
	settled(): Promise<void>;
	clipboard: { writeText(text: string): Promise<void> };
}

function clipboardThat(answer: "grants" | "refuses"): FakeClipboard {
	const writes: string[] = [];
	let last: Promise<void> = Promise.resolve();
	return {
		writes,
		settled: () => last.catch(() => undefined),
		clipboard: {
			writeText(text: string) {
				writes.push(text);
				last = answer === "grants" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
				return last;
			},
		},
	};
}

function pageWithShare(fake: FakeClipboard | undefined) {
	const dom = new JSDOM(
		`<!DOCTYPE html><html><body>${renderShareDialog(ARTICLE)}<details data-test-share-fallback open><summary>Share</summary><div>${renderSharePanel(ARTICLE)}</div></details><p id="elsewhere">The article itself.</p></body></html>`,
	);
	const shareDialog = initShareDialog({
		document: dom.window.document,
		navigator: fake === undefined ? {} : { clipboard: fake.clipboard },
		setTimeoutFn: (callback, ms) => setTimeout(callback, ms),
		clearTimeoutFn: (id) => clearTimeout(id),
	});
	shareDialog.attach();
	return { dom, shareDialog };
}

function inside(dom: JSDOM, scope: string, selector: string): HTMLElement {
	const element = dom.window.document.querySelector<HTMLElement>(`${scope} ${selector}`);
	assert(element, `"${scope} ${selector}" must be in the page`);
	return element;
}

function click(dom: JSDOM, element: Element): void {
	element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, composed: true }));
}

function copyState(dom: JSDOM, scope: string): { idleHidden: boolean; doneHidden: boolean; status: string } {
	return {
		idleHidden: inside(dom, scope, "[data-share-copy-idle]").hasAttribute("hidden"),
		doneHidden: inside(dom, scope, "[data-share-copy-done]").hasAttribute("hidden"),
		status: inside(dom, scope, "[data-share-status]").textContent ?? "",
	};
}

const IDLE = { idleHidden: false, doneHidden: true, status: "" };
const COPIED = { idleHidden: true, doneHidden: false, status: "Link copied to clipboard" };

describe("share dialog copy", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("reveals every Copy button when the page can write the clipboard", () => {
		const { dom } = pageWithShare(clipboardThat("grants"));

		expect([inside(dom, DIALOG, "[data-share-copy]").hasAttribute("hidden"), inside(dom, FALLBACK, "[data-share-copy]").hasAttribute("hidden")]).toEqual([
			false,
			false,
		]);
	});

	it("keeps Copy hidden, even after a swap, when there is no clipboard to write", () => {
		const { dom, shareDialog } = pageWithShare(undefined);

		shareDialog.reveal();

		expect([inside(dom, DIALOG, "[data-share-copy]").hasAttribute("hidden"), inside(dom, FALLBACK, "[data-share-copy]").hasAttribute("hidden")]).toEqual([
			true,
			true,
		]);
	});

	it("reveals the Copy button of a panel swapped in after load", () => {
		const { dom, shareDialog } = pageWithShare(clipboardThat("grants"));
		const swapped = dom.window.document.createElement("section");
		swapped.id = "swapped";
		swapped.innerHTML = renderSharePanel(ARTICLE);
		dom.window.document.body.append(swapped);
		expect(inside(dom, "#swapped", "[data-share-copy]").hasAttribute("hidden")).toBe(true);

		shareDialog.reveal();

		expect(inside(dom, "#swapped", "[data-share-copy]").hasAttribute("hidden")).toBe(false);
	});

	it("copies the tagged link, shows the check and announces it, then restores after two seconds", async () => {
		const fake = clipboardThat("grants");
		const { dom } = pageWithShare(fake);

		click(dom, inside(dom, DIALOG, "[data-share-copy]"));
		await fake.settled();

		expect(fake.writes).toEqual([COPIED_LINK]);
		expect(copyState(dom, DIALOG)).toEqual(COPIED);
		jest.advanceTimersByTime(1999);
		expect(copyState(dom, DIALOG)).toEqual(COPIED);
		jest.advanceTimersByTime(1);
		expect(copyState(dom, DIALOG)).toEqual(IDLE);
	});

	it("selects the link and names the shortcut when the clipboard refuses", async () => {
		const fake = clipboardThat("refuses");
		const { dom } = pageWithShare(fake);

		click(dom, inside(dom, DIALOG, "[data-share-copy-idle]"));
		await fake.settled();

		const field = inside(dom, DIALOG, "[data-share-field]");
		assert(field instanceof dom.window.HTMLInputElement, "the link sits in a text field");
		expect([field.selectionStart, field.selectionEnd]).toEqual([0, COPIED_LINK.length]);
		expect(copyState(dom, DIALOG)).toEqual({ idleHidden: false, doneHidden: true, status: "Press Ctrl+C" });
		jest.advanceTimersByTime(2000);
		expect(copyState(dom, DIALOG)).toEqual(IDLE);
	});

	it("keeps a single restore timer when Copy is pressed twice in quick succession", async () => {
		const fake = clipboardThat("grants");
		const { dom } = pageWithShare(fake);
		const copy = inside(dom, DIALOG, "[data-share-copy]");

		click(dom, copy);
		await fake.settled();
		jest.advanceTimersByTime(1500);
		click(dom, copy);
		await fake.settled();

		expect(jest.getTimerCount()).toBe(1);
		jest.advanceTimersByTime(1999);
		expect(copyState(dom, DIALOG)).toEqual(COPIED);
		jest.advanceTimersByTime(1);
		expect(copyState(dom, DIALOG)).toEqual(IDLE);
	});

	it("announces a copy from the toolbar's fallback panel in that panel alone", async () => {
		const fake = clipboardThat("grants");
		const { dom } = pageWithShare(fake);

		click(dom, inside(dom, FALLBACK, "[data-share-copy]"));
		await fake.settled();

		expect([copyState(dom, FALLBACK), copyState(dom, DIALOG)]).toEqual([COPIED, IDLE]);
	});

	it("leaves every other click to the page", () => {
		const fake = clipboardThat("grants");
		const { dom } = pageWithShare(fake);
		const elsewhere = dom.window.document.getElementById("elsewhere");
		assert(elsewhere, "the fixture must carry the article");

		click(dom, elsewhere);

		expect(fake.writes).toEqual([]);
		expect(copyState(dom, DIALOG)).toEqual(IDLE);
	});

	it("fails loudly on a Copy button that carries no link", () => {
		const fake = clipboardThat("grants");
		const { dom } = pageWithShare(fake);
		const copy = inside(dom, DIALOG, "[data-share-copy]");
		copy.removeAttribute("data-share-url");
		const errors: string[] = [];
		dom.window.addEventListener("error", (event) => {
			event.preventDefault();
			errors.push(event.message);
		});

		click(dom, copy);

		expect(errors).toEqual(["a copy button always carries the link it copies"]);
		expect(fake.writes).toEqual([]);
	});
});
