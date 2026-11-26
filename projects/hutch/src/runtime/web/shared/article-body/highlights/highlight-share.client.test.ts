import assert from "node:assert/strict";
import { HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	type HighlightSharePayload,
	highlightSharePayload,
	renderHighlightPopoverPanel,
} from "../highlight-popover/highlight-popover.component";
import { HIGHLIGHT_POPOVER_STYLES } from "../highlight-popover/highlight-popover.styles";
import { HAS_WEB_SHARE_CLASS, initHighlightShare, SHARE_FAILED_CLASS, type WebShareData } from "./highlight-share.client";

const HIGHLIGHT_ID = HighlightIdSchema.parse("66666666-6666-4666-8666-666666666666");
const VIEW_URL = "https://readplace.com/view/example.com/post";

const VIEW_PAYLOAD = highlightSharePayload({
	share: { title: "A title", sharing: { kind: "view", url: VIEW_URL }, campaign: "reader-internal" },
	passage: "the passage",
	fragment: "#:~:text=the%20passage",
	beaconUrl: "/queue/abc/highlights/shared?platform=ios",
});

const QUOTE_ONLY_PAYLOAD = highlightSharePayload({
	share: { title: "A title", sharing: { kind: "quote-only", reason: "email-issue" }, campaign: "reader-internal" },
	passage: "the passage",
	fragment: undefined,
	beaconUrl: "/queue/abc/highlights/shared",
});

type ShareAnswer = "resolves" | "aborts" | "refuses";

function rejection(name: string): Error {
	const error = new Error(name);
	error.name = name;
	return error;
}

function page(input: { answer: ShareAnswer | undefined; payload?: HighlightSharePayload; withShare?: boolean }) {
	const panelHtml = renderHighlightPopoverPanel({
		highlightId: HIGHLIGHT_ID,
		note: "A private note",
		quote: "the passage",
		share: input.withShare === false ? undefined : (input.payload ?? VIEW_PAYLOAD),
	});
	const dom = new JSDOM(
		`<!DOCTYPE html><html><head><style>${HIGHLIGHT_POPOVER_STYLES}</style></head><body><main>${panelHtml}</main><p id="outside">Outside</p></body></html>`,
		{ url: "https://readplace.com/queue/abc/view?platform=ios" },
	);
	const document = dom.window.document;
	const calls: string[] = [];
	const shared: WebShareData[] = [];
	const beacons: string[] = [];
	let settle: Promise<void> = Promise.resolve();
	const share =
		input.answer === undefined
			? undefined
			: (data: WebShareData): Promise<void> => {
					shared.push(data);
					calls.push("share");
					settle =
						input.answer === "resolves"
							? Promise.resolve()
							: Promise.reject(rejection(input.answer === "aborts" ? "AbortError" : "NotAllowedError"));
					return settle;
				};
	initHighlightShare({
		document,
		share,
		sendBeacon: (url) => beacons.push(url),
		panels: {
			open: (id) => {
				calls.push(`open:${id}`);
				return true;
			},
		},
	});
	const click = (selector: string): void => {
		const element = document.querySelector<HTMLElement>(selector);
		assert(element, `the page renders ${selector}`);
		element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	};
	const panel = (): HTMLElement => {
		const element = document.getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
		assert(element);
		return element;
	};
	const displayOf = (selector: string): string => {
		const element = panel().querySelector(selector);
		assert(element);
		return dom.window.getComputedStyle(element).display;
	};
	const settled = async (): Promise<void> => {
		await settle.catch(() => undefined);
		await Promise.resolve();
	};
	return { document, calls, shared, beacons, click, panel, displayOf, settled };
}

function queryOf(beacon: string): { path: string; query: Record<string, string> } {
	const url = new URL(beacon, "https://readplace.com");
	return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
}

describe("initHighlightShare", () => {
	it("marks the root once the device can share, so the Share item shows and the target list hides", () => {
		const h = page({ answer: "resolves" });

		assert.equal(h.document.documentElement.classList.contains(HAS_WEB_SHARE_CLASS), true);
		assert.equal(h.displayOf("[data-highlight-share]"), "flex");
		assert.equal(h.displayOf("[data-highlight-share-targets]"), "none");
	});

	it("leaves the root class off where the device cannot share, so the target list shows", () => {
		const h = page({ answer: undefined });
		h.click("[data-highlight-share]");

		assert.equal(h.document.documentElement.classList.contains(HAS_WEB_SHARE_CLASS), false);
		assert.equal(h.displayOf("[data-highlight-share]"), "none");
		assert.equal(h.displayOf("[data-highlight-share-targets]"), "flex");
		assert.deepEqual(h.calls, []);
		assert.deepEqual(h.beacons, []);
	});

	it("shares the quote, the title and the link, and records the native share once it resolves", async () => {
		const h = page({ answer: "resolves" });

		h.click("[data-highlight-share]");
		await h.settled();

		assert.deepEqual(h.shared, [
			{
				text: "“the passage”",
				title: "A title",
				url: `${VIEW_URL}?utm_source=highlight-share&utm_medium=native-share&utm_campaign=reader-internal&utm_content=reader-view#:~:text=the%20passage`,
			},
		]);
		assert.deepEqual(h.beacons.map(queryOf), [
			{
				path: "/queue/abc/highlights/shared",
				query: {
					platform: "ios",
					highlight: HIGHLIGHT_ID,
					method: "native-share",
					linked: "view",
					fragment: "true",
				},
			},
		]);
	});

	it("shares only the quote of an article that shares no link", async () => {
		const h = page({ answer: "resolves", payload: QUOTE_ONLY_PAYLOAD });

		h.click("[data-highlight-share]");
		await h.settled();

		assert.deepEqual(h.shared, [{ text: "“the passage”" }]);
		assert.deepEqual(h.beacons.map(queryOf).map(({ query }) => query), [
			{ highlight: HIGHLIGHT_ID, method: "native-share", linked: "none", fragment: "false" },
		]);
	});

	it("says nothing and reopens nothing when the reader cancels the share", async () => {
		const h = page({ answer: "aborts" });

		h.click("[data-highlight-share]");
		await h.settled();

		assert.deepEqual(h.calls, ["share"]);
		assert.deepEqual(h.beacons, []);
		assert.equal(h.panel().classList.contains(SHARE_FAILED_CLASS), false);
	});

	it("reopens the panel once with its target list showing when the share is refused", async () => {
		const h = page({ answer: "refuses" });

		h.click("[data-highlight-share]");
		await h.settled();

		assert.deepEqual(h.calls, ["share", `open:${HIGHLIGHT_ID}`]);
		assert.deepEqual(h.beacons, []);
		assert.equal(h.displayOf("[data-highlight-share-targets]"), "flex");
	});

	it("records a target click by its method, without sharing natively", () => {
		const h = page({ answer: "resolves" });

		h.click('[data-highlight-share-target="whatsapp"]');

		assert.deepEqual(h.calls, []);
		assert.deepEqual(h.beacons.map(queryOf), [
			{
				path: "/queue/abc/highlights/shared",
				query: { platform: "ios", highlight: HIGHLIGHT_ID, method: "whatsapp", linked: "view", fragment: "true" },
			},
		]);
	});

	it("ignores clicks on other panel items, outside panels, and in a panel with no Share item", () => {
		const h = page({ answer: "resolves" });
		h.click('[data-test-action="highlight-panel-note"]');
		h.click("#outside");
		const bare = page({ answer: "resolves", withShare: false });
		bare.click('[data-test-action="highlight-panel-note"]');

		assert.deepEqual([h.calls, h.beacons, bare.calls, bare.beacons], [[], [], [], []]);
	});

	it("fails loudly when a panel with a Share item names no beacon", () => {
		const h = page({ answer: "resolves" });
		h.panel().removeAttribute("data-highlight-share-beacon");
		const errors: string[] = [];
		h.document.defaultView?.addEventListener("error", (event) => {
			event.preventDefault();
			errors.push(event.message);
		});

		h.click('[data-highlight-share-target="x"]');

		assert.deepEqual([errors, h.beacons], [["the share item carries data-highlight-share-beacon"], []]);
	});
});
