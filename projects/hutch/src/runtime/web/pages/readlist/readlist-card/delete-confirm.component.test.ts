import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
	DELETE_ACK_NEVER,
	buildArticleDeletion,
	deleteConfirmPopoverId,
	renderDeleteConfirm,
	renderDeleteMenuItems,
} from "./delete-confirm.component";

function panelFor(url: string, title = "A Saved Article") {
	const { document } = parseHTML(
		`<div>${renderDeleteConfirm({
			confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", url },
			surface: "queue-card",
			title,
		})}</div>`,
	);
	return document;
}

describe("deleteConfirmPopoverId", () => {
	it("prefixes the hash so the id is a legal CSS ident, not just a legal HTML id", () => {
		const popoverId = deleteConfirmPopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("readlist-delete-confirm-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
		expect(popoverId).toMatch(/^[a-zA-Z_-]/);
	});
});

describe("renderDeleteConfirm", () => {
	it("stamps the same internal tracking the card's delete form carries", () => {
		const form = panelFor("/queue/abc123/delete").querySelector("form");

		assert(form, "the confirmation must post through a form");
		const action = form.getAttribute("action") ?? "";
		expect(action).toContain("utm_source=queue-card");
		expect(action).toContain("utm_medium=internal");
		expect(action).toContain("utm_content=delete");
	});

	it("preserves the return query so confirming keeps the reader on the same view", () => {
		const form = panelFor("/queue/abc123/delete?tab=done&order=asc").querySelector("form");

		assert(form, "the confirmation must post through a form");
		const action = form.getAttribute("action") ?? "";
		expect(action).toContain("tab=done");
		expect(action).toContain("order=asc");
	});

	it("opens on the article id so one page of cards keeps its panels apart", () => {
		const doc = panelFor("/queue/abc123/delete");

		const panel = doc.querySelector("[data-test-confirm-popover='delete']");
		assert(panel, "a delete panel must be rendered");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("abc123");
		expect(panel.getAttribute("id")).toBe("readlist-delete-confirm-abc123");
	});

	it("names the article for a screen reader without repeating it on screen", () => {
		const doc = panelFor("/queue/abc123/delete", "The Pragmatic Programmer");

		const lead = doc.getElementById("readlist-delete-confirm-abc123-lead");
		assert(lead, "the panel must name the article it is about");
		expect(lead.textContent).toBe("Article: The Pragmatic Programmer");
		expect(lead.className).toBe("sr-only");
	});

	it("offers both a plain deletion and one that also silences the panel", () => {
		const doc = panelFor("/queue/abc123/delete");

		const confirm = doc.querySelector("[data-test-action='delete-confirm']");
		const never = doc.querySelector("[data-test-action='delete-confirm-never']");
		assert(confirm, "the plain confirmation must be rendered");
		assert(never, "the silencing confirmation must be rendered");
		expect(confirm.textContent).toBe("Delete article");
		expect(never.textContent).toBe("Delete and don't ask again");
		expect([...doc.querySelectorAll(".confirm-popover__buttons button")].map((button) => button.getAttribute("data-test-action"))).toEqual(["delete-confirm-never", "delete-confirm"]);
		expect(confirm.classList.contains("btn--primary")).toBe(true);
		expect(never.classList.contains("btn--neutral")).toBe(true);
		// Both submit the same form, so the second deletes as well as remembering.
		expect(confirm.closest("form")).toBe(never.closest("form"));
		expect(confirm.hasAttribute("name")).toBe(false);
		expect(never.getAttribute("name")).toBe("ack");
		expect(never.getAttribute("value")).toBe(DELETE_ACK_NEVER);
	});

	it("explains that the article can be saved again", () => {
		const body = panelFor("/queue/abc123/delete").querySelector(".confirm-popover__body");
		assert(body, "the delete panel must explain the outcome");
		expect(body.textContent).toBe("This article will be removed from your readlist. You can save it again later.");
	});

	it("boosts the confirmation so deleting re-renders the listing in place", () => {
		const form = panelFor("/queue/abc123/delete").querySelector("form");

		assert(form, "the confirmation must post through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
	});

	it("illustrates the panel when the caller supplies artwork", () => {
		const { document } = parseHTML(
			`<div>${renderDeleteConfirm({
				confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", url: "/queue/abc123/delete" },
				surface: "queue-card",
				title: "A Saved Article",
				illustrationHtml: "<svg data-test-trash-illustration></svg>",
			})}</div>`,
		);

		const panel = document.querySelector(".confirm-popover");
		assert(panel, "the panel must render");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(true);
		expect(document.querySelectorAll(".confirm-popover__illustration svg[data-test-trash-illustration]")).toHaveLength(
			1,
		);
	});

	it("omits the illustration modifier when the caller supplies no artwork", () => {
		const doc = panelFor("/queue/abc123/delete");

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "the panel must render");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(false);
	});
});

function focusTargets(scope: ParentNode): (string | null)[] {
	return Array.from(scope.querySelectorAll("[autofocus]"), (target) => target.getAttribute("data-test-action"));
}

describe("renderDeleteConfirm opening focus", () => {
	it("opens on Delete article, so Enter confirms and the never-ask submit stays a deliberate choice", () => {
		expect(focusTargets(panelFor("/queue/abc123/delete"))).toEqual(["delete-confirm"]);
	});
});

describe("buildArticleDeletion", () => {
	it("asks first while the reader has not silenced the confirmation", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "?tab=done", acknowledged: false });

		expect(deletion).toEqual({
			articleId: "abc123",
			url: "/queue/abc123/delete?tab=done",
			confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", url: "/queue/abc123/delete?tab=done" },
		});
	});

	it("asks first when the caller never read the signal", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: undefined });

		expect(deletion.confirm?.popoverId).toBe("readlist-delete-confirm-abc123");
	});

	it("deletes straight away once the reader chose not to be asked again", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: true });

		expect(deletion).toEqual({ articleId: "abc123", url: "/queue/abc123/delete", confirm: undefined });
	});
});

describe("renderDeleteMenuItems", () => {
	function itemsFor(input: Parameters<typeof renderDeleteMenuItems>[0]) {
		return parseHTML(`<div>${renderDeleteMenuItems(input)}</div>`).document;
	}

	it("opens the confirmation and keeps a plain-post fallback while the reader is still asked", () => {
		const doc = itemsFor({
			deletion: buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: false }),
			surface: "queue-card",
		});

		const trigger = doc.querySelector("[data-test-action='delete']");
		const fallback = doc.querySelector("[data-test-action='delete-fallback']");
		assert(trigger, "the confirmation trigger must be rendered");
		assert(fallback, "the plain-post fallback must be rendered");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-delete-confirm-abc123");
		expect(fallback.getAttribute("type")).toBe("submit");
		expect(fallback.closest("form")?.classList.contains("article-delete__form--fallback")).toBe(true);
	});

	it("submits straight away once the reader silenced the confirmation", () => {
		const doc = itemsFor({
			deletion: buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: true }),
			surface: "queue-card",
		});

		const control = doc.querySelector("[data-test-action='delete']");
		assert(control, "the delete control must be rendered");
		expect(control.getAttribute("type")).toBe("submit");
		expect(control.closest("form")?.getAttribute("method")).toBe("POST");
		expect(doc.querySelectorAll("[popovertarget]")).toHaveLength(0);
	});

	it("keeps a list card's scroll position but lands the reader at the top of its readlist", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: true });

		const swaps = (["queue-card", "reader"] as const).map((surface) =>
			itemsFor({ deletion, surface }).querySelector("form")?.getAttribute("hx-swap"),
		);

		expect(swaps).toEqual(["outerHTML show:none", "outerHTML show:window:top"]);
	});

	it("credits the deletion to the surface it was made from", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "?queue=work", acknowledged: true });

		const action = new URL(
			itemsFor({ deletion, surface: "reader" }).querySelector("form")?.getAttribute("action") ?? "",
			"https://internal.invalid",
		);

		expect([action.pathname, action.searchParams.get("queue"), action.searchParams.get("utm_source"), action.searchParams.get("utm_content")]).toEqual([
			"/queue/abc123/delete",
			"work",
			"reader",
			"delete",
		]);
	});

	it("never posts a status field, so a native host never reads a deletion as a mark-read", () => {
		const doc = itemsFor({
			deletion: buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: false }),
			surface: "reader",
		});

		expect(doc.querySelectorAll("[name='status']")).toHaveLength(0);
	});
});

describe("renderDeleteConfirm on the reader", () => {
	it("credits the confirmed deletion to the reader and lands at the top of the readlist", () => {
		const { document } = parseHTML(
			`<div>${renderDeleteConfirm({
				confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", url: "/queue/abc123/delete" },
				surface: "reader",
				title: "A Saved Article",
			})}</div>`,
		);

		const form = document.querySelector("form");
		assert(form, "the confirmation must post through a form");
		expect(new URL(form.getAttribute("action") ?? "", "https://internal.invalid").searchParams.get("utm_source")).toBe(
			"reader",
		);
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:window:top");
	});
});
