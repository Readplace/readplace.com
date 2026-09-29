import assert from "node:assert/strict";
import type { ArticleStatus } from "@packages/domain/article";
import { DEFAULT_READLIST, ReadlistSlugSchema, type ReadlistRef } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { parseHTML } from "linkedom";
import {
	MARK_STATUS_ACK_NEVER,
	markStatusConfirmPopoverId,
	renderMarkStatusConfirm,
} from "./mark-status-confirm.component";

function panelFor(
	overrides: {
		status?: ArticleStatus;
		readlists?: readonly ReadlistRef[];
		url?: string;
		source?: "queue-card" | "reader";
		lead?: string;
	} = {},
) {
	const { document } = parseHTML(
		`<div>${renderMarkStatusConfirm({
			confirm: {
				articleId: "abc123",
				popoverId: "readlist-mark-status-confirm-abc123",
				url: overrides.url ?? "/queue/abc123/status",
				status: overrides.status ?? "read",
				readlists: overrides.readlists ?? [DEFAULT_READLIST, { slug: ReadlistSlugSchema.parse("work"), label: "Work" }, { slug: ReadlistSlugSchema.parse("later"), label: "Later" }],
			},
			source: overrides.source ?? "queue-card",
			lead: overrides.lead,
		})}</div>`,
	);
	return document;
}

describe("markStatusConfirmPopoverId", () => {
	it("prefixes the hash so the id is a legal CSS ident, not just a legal HTML id", () => {
		const popoverId = markStatusConfirmPopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("readlist-mark-status-confirm-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
		expect(popoverId).toMatch(/^[a-zA-Z_-]/);
	});
});

describe("renderMarkStatusConfirm", () => {
	it("names every readlist the change will reach, one bullet each, in the order the rail lists them", () => {
		const doc = panelFor();
		const body = doc.getElementById("readlist-mark-status-confirm-abc123-body");
		const items = doc.getElementById("readlist-mark-status-confirm-abc123-items");

		assert(body, "the panel must state what the change will do");
		assert(items, "the panel must list the readlists it will reach");
		expect(body.textContent).toBe("This article also appears in other readlists. Marking it as read will update it everywhere:");
		expect(items.tagName).toBe("UL");
		expect([...items.querySelectorAll(".confirm-popover__item-label")].map((label) => label.textContent)).toEqual([
			"All",
			"Work",
			"Later",
		]);
		const rowIcons = [...items.querySelectorAll("li svg")];
		expect(rowIcons).toHaveLength(3);
		expect(rowIcons.map((icon) => icon.getAttribute("aria-hidden"))).toEqual(["true", "true", "true"]);
		expect(rowIcons.map((icon) => icon.innerHTML)).toEqual(
			[iconSvg("file"), iconSvg("folder"), iconSvg("folder")].map((svg) => {
				const icon = parseHTML(`<div>${svg}</div>`).document.querySelector("svg");
				assert(icon, "the icon set must render each readlist kind");
				return icon.innerHTML;
			}),
		);
	});

	it("describes the panel by the sentence and the list together, so both are announced", () => {
		const panel = panelFor().querySelector("[data-test-confirm-popover='mark-status']");

		assert(panel, "the panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"readlist-mark-status-confirm-abc123-body readlist-mark-status-confirm-abc123-items",
		);
	});

	it("asks about the direction the reader is actually taking", () => {
		const read = panelFor({ status: "read" }).querySelector(".confirm-popover__title");
		const unread = panelFor({ status: "unread", readlists: [DEFAULT_READLIST] });

		assert(read, "the panel must carry a title");
		expect(read.textContent).toBe("Mark as read in all readlists?");
		expect(unread.querySelector(".confirm-popover__title")?.textContent).toBe(
			"Mark as unread in all readlists?",
		);
		expect(
			unread.getElementById("readlist-mark-status-confirm-abc123-body")?.textContent,
		).toBe("This article will be marked as unread in all readlists it belongs to:");
		expect(
			[
				...(unread
					.getElementById("readlist-mark-status-confirm-abc123-items")
					?.querySelectorAll("li") ?? []),
			].map((li) => li.textContent),
		).toEqual(["All"]);
		expect(unread.querySelector("[data-test-action='mark-status-confirm']")?.textContent).toBe("Mark as unread everywhere");
		expect(unread.querySelector("[data-test-action='mark-status-confirm-never']")?.textContent).toBe("Mark as unread and don't ask again");
	});

	it("offers both a plain confirmation and one that also silences the panel", () => {
		const doc = panelFor();
		const confirm = doc.querySelector("[data-test-action='mark-status-confirm']");
		const never = doc.querySelector("[data-test-action='mark-status-confirm-never']");

		assert(confirm, "the plain confirmation must be rendered");
		assert(never, "the suppressing confirmation must be rendered");
		expect(confirm.textContent).toBe("Mark as read everywhere");
		expect(never.textContent).toBe("Mark as read and don't ask again");
		expect([...doc.querySelectorAll(".confirm-popover__buttons button")].map((button) => button.getAttribute("data-test-action"))).toEqual(["mark-status-confirm-never", "mark-status-confirm"]);
		expect(confirm.classList.contains("btn--primary")).toBe(true);
		expect(never.classList.contains("btn--neutral")).toBe(true);
		expect(confirm.getAttribute("type")).toBe("submit");
		expect(never.getAttribute("type")).toBe("submit");
		expect(confirm.getAttribute("name")).toBeNull();
		expect(never.getAttribute("name")).toBe("ack");
		expect(never.getAttribute("value")).toBe(MARK_STATUS_ACK_NEVER);
		expect(confirm.closest("form")).toBe(never.closest("form"));
	});

	it("submits the status the reader is moving to", () => {
		const status = panelFor({ status: "unread" }).querySelector("input[name='status']");

		assert(status, "the panel must carry the target status");
		expect(status.getAttribute("value")).toBe("unread");
	});

	it("drops the card swap so the confirmed change re-renders the whole listing", () => {
		const form = panelFor({ url: "/queue/abc123/status?tab=done&order=asc" }).querySelector(
			"form",
		);

		assert(form, "the confirmation must post through a form");
		const action = form.getAttribute("action") ?? "";
		expect(action).toContain("tab=done");
		expect(action).toContain("order=asc");
		expect(new URL(action, "https://example.com").searchParams.get("swap")).toBeNull();
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
	});

	it("attributes the click to the surface the panel was opened from", () => {
		const card = panelFor({ source: "queue-card" }).querySelector("form");
		const reader = panelFor({ source: "reader" }).querySelector("form");

		assert(card, "the card panel must post through a form");
		assert(reader, "the reader panel must post through a form");
		expect(card.getAttribute("action")).toContain("utm_source=queue-card");
		expect(reader.getAttribute("action")).toContain("utm_source=reader");
		expect(card.getAttribute("action")).toContain("utm_content=mark-status");
	});

	it("names the article for a screen reader on a listing, and stays quiet in the reader", () => {
		const listing = panelFor({ lead: "The Pragmatic Programmer" });
		const reader = panelFor({ source: "reader" });

		const lead = listing.getElementById("readlist-mark-status-confirm-abc123-lead");
		assert(lead, "the listing panel must name the article it is about");
		expect(lead.textContent).toBe("The Pragmatic Programmer");
		expect(lead.className).toBe("sr-only");

		const panel = reader.querySelector("[data-test-confirm-popover='mark-status']");
		assert(panel, "the reader panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"readlist-mark-status-confirm-abc123-body readlist-mark-status-confirm-abc123-items",
		);
	});

	it("opens on the article id so one page of cards keeps its panels apart", () => {
		const panel = panelFor().querySelector("[data-test-confirm-popover='mark-status']");

		assert(panel, "a mark-status panel must be rendered");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("abc123");
		expect(panel.getAttribute("id")).toBe("readlist-mark-status-confirm-abc123");
		expect([...panel.querySelectorAll(".confirm-popover__header [data-test-action]")].map((action) => action.getAttribute("data-test-action"))).toEqual(["mark-status-dismiss"]);
	});
});
