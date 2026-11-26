import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { highlightsRailRowViews } from "../highlights-rail/highlights-rail.component";
import {
	type HighlightShareInput,
	type HighlightSharePayload,
	highlightSharePayload,
	renderHighlightPopoverHint,
	renderHighlightPopoverPanel,
	renderHighlightPopovers,
} from "./highlight-popover.component";

const HIGHLIGHT_ID = HighlightIdSchema.parse("66666666-6666-4666-8666-666666666666");

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function actionsOf(panel: Element): (string | null)[] {
	return Array.from(panel.querySelectorAll(".highlight-popover__actions > button"), (button) =>
		button.getAttribute("data-test-action"),
	);
}

describe("renderHighlightPopoverPanel", () => {
	it("renders one highlight's actions with its note as text behind the note hook", () => {
		const doc = parse(renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: "Kept <b>note</b>", quote: "the passage", share: undefined }));
		const panel = doc.getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
		assert(panel);

		assert.equal(panel.getAttribute("data-highlight-popover"), HIGHLIGHT_ID);
		assert.equal(panel.getAttribute("aria-describedby"), `manage-highlight-${HIGHLIGHT_ID}-note`);
		assert.equal(panel.querySelector("[data-highlight-note-text]")?.textContent, "Kept <b>note</b>");
		assert.deepEqual(actionsOf(panel), [
			"highlight-panel-note",
			"highlight-panel-copy",
			"highlight-panel-note-delete",
			"highlight-panel-delete",
		]);
		const note = panel.querySelector('[data-test-action="highlight-panel-note"]');
		assert.equal(note?.getAttribute("popovertarget"), `note-highlight-${HIGHLIGHT_ID}`);
		assert.equal(note?.textContent?.trim(), "Edit note");
		assert.equal(
			panel.querySelector('[data-test-action="highlight-panel-note-delete"]')?.getAttribute("form"),
			`delete-note-highlight-${HIGHLIGHT_ID}`,
		);
		assert.equal(
			panel.querySelector('[data-test-action="highlight-panel-delete"]')?.getAttribute("popovertarget"),
			`delete-highlight-${HIGHLIGHT_ID}`,
		);
	});

	it("offers Copy highlight carrying the quote as escaped text, without autofocus", () => {
		const panel = parse(
			renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: undefined, quote: `Say "<b>hi</b>" & go`, share: undefined }),
		).getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
		assert(panel);
		const copy = panel.querySelector('[data-test-action="highlight-panel-copy"]');
		assert(copy);

		assert.equal(copy.getAttribute("data-highlight-copy"), `Say "<b>hi</b>" & go`);
		assert.equal(copy.querySelector("b"), null);
		assert.equal(copy.classList.contains("highlight-popover__copy"), true);
		assert.equal(copy.hasAttribute("autofocus"), false);
		assert.equal(copy.hasAttribute("hidden"), false);
		assert.equal(copy.textContent?.trim(), "Copy highlight");
	});

	it("offers Add note and no note block or Delete note when the highlight has no note", () => {
		const panel = parse(renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: undefined, quote: "the passage", share: undefined })).getElementById(
			`manage-highlight-${HIGHLIGHT_ID}`,
		);
		assert(panel);

		assert.equal(panel.hasAttribute("aria-describedby"), false);
		assert.equal(panel.querySelector("[data-highlight-note-text]"), null);
		assert.deepEqual(actionsOf(panel), ["highlight-panel-note", "highlight-panel-copy", "highlight-panel-delete"]);
		assert.equal(panel.querySelector('[data-test-action="highlight-panel-note"]')?.textContent?.trim(), "Add note");
	});
});

describe("renderHighlightPopoverHint", () => {
	it("renders the hidden hint the highlights are described by", () => {
		const hint = parse(renderHighlightPopoverHint()).getElementById("manage-highlight-hint");

		assert.equal(hint?.hasAttribute("hidden"), true);
		assert.equal(hint?.textContent, "Opens this highlight's actions");
	});
});

describe("renderHighlightPopovers", () => {
	const SCOPE = { articleId: "abc", readlist: [], surface: [] };
	const OTHER_ID = HighlightIdSchema.parse("77777777-7777-4777-8777-777777777777");

	function highlight(highlightId: Highlight["highlightId"]): Highlight {
		return {
			highlightId,
			highlightOf: "https://example.com/post",
			exact: "beta",
			prefix: "",
			suffix: "",
			start: 0,
			end: 4,
			anchoredContentHash: "hash",
			anchorState: "anchored",
			orderKey: 0,
			createdAt: new Date("2026-11-01T00:00:00.000Z"),
			updatedAt: new Date("2026-11-01T00:00:00.000Z"),
			anchorRevision: 0,
		};
	}

	function rows(marked: { [id: string]: boolean }) {
		return [HIGHLIGHT_ID, OTHER_ID].map((id) => ({
			highlight: highlight(id),
			shown: { state: "anchored" as const, edited: false, quote: "beta" },
			marked: marked[id] === true,
		}));
	}

	it("renders the hint and a panel only for each highlight marked on the page", () => {
		const doc = parse(
			renderHighlightPopovers({
				views: highlightsRailRowViews({ rows: rows({ [HIGHLIGHT_ID]: true }), scope: SCOPE, openNote: undefined }),
				shares: undefined,
			}),
		);

		assert.notEqual(doc.getElementById("manage-highlight-hint"), null);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-highlight-popover]"), (panel) => panel.getAttribute("data-highlight-popover")),
			[HIGHLIGHT_ID],
		);
	});

	it("gives an edited highlight's panel the quote shown in this version", () => {
		const edited = [
			{
				highlight: { ...highlight(HIGHLIGHT_ID), exact: "beta" },
				shown: { state: "anchored" as const, edited: true, quote: "beta prime" },
				marked: true,
			},
		];
		const doc = parse(renderHighlightPopovers({
				views: highlightsRailRowViews({ rows: edited, scope: SCOPE, openNote: undefined }),
				shares: undefined,
			}));

		assert.equal(
			doc.querySelector('[data-test-action="highlight-panel-copy"]')?.getAttribute("data-highlight-copy"),
			"beta prime",
		);
	});

	it("renders an empty container when the rows carry no form scope", () => {
		const doc = parse(
			renderHighlightPopovers({
				views: highlightsRailRowViews({
					rows: rows({ [HIGHLIGHT_ID]: true, [OTHER_ID]: true }),
					scope: undefined,
					openNote: undefined,
				}),
				shares: undefined,
			}),
		);

		assert.equal(doc.getElementById("manage-highlights")?.children.length, 0);
	});

	it("gives each panel the share payload kept for its highlight", () => {
		const payload = highlightSharePayload({
			share: { title: "A title", sharing: { kind: "original", url: "https://example.com/post" }, campaign: "reader-internal" },
			passage: "beta",
			fragment: undefined,
			beaconUrl: "/queue/abc/highlights/shared",
		});
		const doc = parse(
			renderHighlightPopovers({
				views: highlightsRailRowViews({ rows: rows({ [HIGHLIGHT_ID]: true, [OTHER_ID]: true }), scope: SCOPE, openNote: undefined }),
				shares: new Map([[HIGHLIGHT_ID, payload]]),
			}),
		);

		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-highlight-popover]"), (panel) => [
				panel.getAttribute("data-highlight-popover"),
				panel.querySelector("[data-highlight-share]")?.getAttribute("data-share-text") ?? null,
			]),
			[
				[HIGHLIGHT_ID, "“beta”"],
				[OTHER_ID, null],
			],
		);
	});
});

const TITLE = "Dashes — and “quotes”";
const PASSAGE = "It’s a — test, & more";
const QUOTE = `“${PASSAGE}”`;
const VIEW_URL = "https://readplace.com/view/example.com/post";
const ORIGINAL_URL = "https://example.com/post?ref=1";
const BEACON_URL = "/queue/abc/highlights/shared?platform=ios";

function shareInput(sharing: HighlightShareInput["sharing"]): HighlightShareInput {
	return { title: TITLE, sharing, campaign: "reader-internal" };
}

function payloadFor(input: { sharing: HighlightShareInput["sharing"]; fragment: string | undefined }): HighlightSharePayload {
	return highlightSharePayload({
		share: shareInput(input.sharing),
		passage: PASSAGE,
		fragment: input.fragment,
		beaconUrl: BEACON_URL,
	});
}

function sharePanel(payload: HighlightSharePayload): Element {
	const panel = parse(
		renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: "A private note", quote: PASSAGE, share: payload }),
	).getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
	assert(panel);
	return panel;
}

function shareAttributesOf(panel: Element): Record<string, string> {
	const button = panel.querySelector("[data-highlight-share]");
	assert(button);
	return Object.fromEntries(
		Array.from(button.attributes)
			.filter((attribute) => attribute.name.startsWith("data-share-"))
			.map((attribute) => [attribute.name, attribute.value]),
	);
}

function targetHrefsOf(panel: Element): [string | null, string | null][] {
	return Array.from(panel.querySelectorAll("[data-highlight-share-target]"), (target) => [
		target.getAttribute("data-highlight-share-target"),
		target.getAttribute("href"),
	]);
}

function taggedView(medium: string): string {
	return `${VIEW_URL}?utm_source=highlight-share&utm_medium=${medium}&utm_campaign=reader-internal&utm_content=reader-view`;
}

describe("highlightSharePayload in a panel", () => {
	it("lists the panel's items in order, with Share highlight after Copy and its targets before the delete items", () => {
		const panel = sharePanel(payloadFor({ sharing: { kind: "original", url: ORIGINAL_URL }, fragment: undefined }));

		assert.deepEqual(
			Array.from(
				panel.querySelectorAll("[data-test-action], [data-test-highlight-share-target]"),
				(item) => item.getAttribute("data-test-action") ?? `target:${item.getAttribute("data-test-highlight-share-target")}`,
			),
			[
				"highlight-panel-note",
				"highlight-panel-copy",
				"highlight-panel-share",
				"target:whatsapp",
				"target:facebook",
				"target:x",
				"target:email",
				"target:reddit",
				"highlight-panel-note-delete",
				"highlight-panel-delete",
			],
		);
		const share = panel.querySelector('[data-test-action="highlight-panel-share"]');
		assert.equal(share?.textContent?.trim(), "Share highlight");
		assert.equal(share?.hasAttribute("autofocus"), false);
		assert.equal(panel.querySelector("[data-highlight-share-targets] p")?.textContent, "Share highlight");
		assert.equal(panel.getAttribute("data-highlight-share-beacon"), BEACON_URL);
	});

	it("shares an email issue's quote alone, through WhatsApp, X and email", () => {
		const panel = sharePanel(payloadFor({ sharing: { kind: "quote-only", reason: "email-issue" }, fragment: "#:~:text=x" }));

		assert.deepEqual(shareAttributesOf(panel), {
			"data-share-text": QUOTE,
			"data-share-linked": "none",
			"data-share-fragment": "false",
		});
		assert.deepEqual(targetHrefsOf(panel), [
			["whatsapp", `https://wa.me/?text=${encodeURIComponent(QUOTE)}`],
			["x", `https://x.com/intent/post?text=${encodeURIComponent(QUOTE)}`],
			["email", `mailto:?body=${encodeURIComponent(QUOTE)}`],
		]);
	});

	it("shares a private upload's quote alone, through WhatsApp, X and email", () => {
		const panel = sharePanel(payloadFor({ sharing: { kind: "quote-only", reason: "private-upload" }, fragment: undefined }));

		assert.deepEqual(shareAttributesOf(panel), {
			"data-share-text": QUOTE,
			"data-share-linked": "none",
			"data-share-fragment": "false",
		});
		assert.deepEqual(
			targetHrefsOf(panel).map(([key]) => key),
			["whatsapp", "x", "email"],
		);
	});

	it("links a shareable article's /view page, tagged per medium, with the text fragment after the query", () => {
		const fragment = "#:~:text=It%E2%80%99s%20a%20%E2%80%94%20test";
		const panel = sharePanel(payloadFor({ sharing: { kind: "view", url: VIEW_URL }, fragment }));
		const link = (medium: string): string => `${taggedView(medium)}${fragment}`;

		assert.deepEqual(shareAttributesOf(panel), {
			"data-share-text": QUOTE,
			"data-share-title": TITLE,
			"data-share-url": link("native-share"),
			"data-share-linked": "view",
			"data-share-fragment": "true",
		});
		assert.deepEqual(targetHrefsOf(panel), [
			["whatsapp", `https://wa.me/?text=${encodeURIComponent(`${QUOTE}\n${TITLE} ${link("whatsapp")}`)}`],
			["facebook", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link("facebook"))}`],
			[
				"x",
				`https://x.com/intent/post?url=${encodeURIComponent(link("x"))}&text=${encodeURIComponent(`${QUOTE}\n${TITLE}`)}`,
			],
			[
				"email",
				`mailto:?subject=${encodeURIComponent(TITLE)}&body=${encodeURIComponent(`${QUOTE}\r\n\r\n${link("email")}`)}`,
			],
			[
				"reddit",
				`https://www.reddit.com/submit?url=${encodeURIComponent(link("reddit"))}&title=${encodeURIComponent(TITLE)}`,
			],
		]);
	});

	it("links the untagged original with no fragment when the reader view is not shareable", () => {
		const panel = sharePanel(payloadFor({ sharing: { kind: "original", url: ORIGINAL_URL }, fragment: "#:~:text=x" }));

		assert.deepEqual(shareAttributesOf(panel), {
			"data-share-text": QUOTE,
			"data-share-title": TITLE,
			"data-share-url": ORIGINAL_URL,
			"data-share-linked": "original",
			"data-share-fragment": "false",
		});
		assert.equal(
			targetHrefsOf(panel)[0][1],
			`https://wa.me/?text=${encodeURIComponent(`${QUOTE}\n${TITLE} ${ORIGINAL_URL}`)}`,
		);
	});

	it("never carries the note in the payload or the target links", () => {
		const panel = sharePanel(payloadFor({ sharing: { kind: "view", url: VIEW_URL }, fragment: undefined }));
		const shared = [
			...Object.values(shareAttributesOf(panel)),
			...targetHrefsOf(panel).map(([, href]) => decodeURIComponent(href ?? "")),
		];

		assert.deepEqual(
			shared.filter((value) => value.includes("A private note")),
			[],
		);
		assert.equal(shareAttributesOf(panel)["data-share-url"], taggedView("native-share"));
	});
});
