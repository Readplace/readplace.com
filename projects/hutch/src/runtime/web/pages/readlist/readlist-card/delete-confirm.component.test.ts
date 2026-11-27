import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
	DELETE_ACK_NEVER,
	READER_MENU_TOGGLE_ID,
	buildArticleDeletion,
	deleteConfirmPopoverId,
	renderDeleteConfirm,
	renderDeleteFallback,
	renderDeleteMenuItems,
	renderDeletionDecisions,
	renderRetiredDeletionDecisionsOob,
} from "./delete-confirm.component";

function panelFor(url: string, title = "A Saved Article") {
	const { document } = parseHTML(
		`<div>${renderDeleteConfirm({
			confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", fallbackId: "confirm-remove-abc123", url },
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

	it("names the article on screen once, as part of what the panel describes", () => {
		const doc = panelFor("/queue/abc123/delete", "The Pragmatic Programmer");

		const panel = doc.querySelector("[data-test-confirm-popover='delete']");
		const subheading = doc.getElementById("readlist-delete-confirm-abc123-subheading");
		assert(panel, "a delete panel must be rendered");
		assert(subheading, "the panel must name the article it is about");
		expect(subheading.textContent).toBe("The Pragmatic Programmer");
		expect(subheading.getAttribute("data-text-from")).toBe("readlist-title-abc123");
		expect(doc.querySelectorAll(".sr-only")).toHaveLength(0);
		expect(panel.getAttribute("aria-describedby")).toBe(
			"readlist-delete-confirm-abc123-subheading readlist-delete-confirm-abc123-body",
		);
		expect(doc.querySelector(".confirm-popover__title")?.textContent).toBe("Remove this article from this readlist?");
	});

	it("escapes an article title holding HTML punctuation and keeps it as text", () => {
		const title = `Tags like <b> & "quotes" aren't markup`;
		const doc = panelFor("/queue/abc123/delete", title);

		expect(doc.querySelectorAll(".confirm-popover b")).toHaveLength(0);
		expect(doc.getElementById("readlist-delete-confirm-abc123-subheading")?.textContent).toBe(title);
	});

	it("offers Cancel, a plain deletion and one that also skips future questions", () => {
		const doc = panelFor("/queue/abc123/delete");

		const cancel = doc.querySelector("[data-test-action='delete-cancel']");
		const confirm = doc.querySelector("[data-test-action='delete-confirm']");
		const never = doc.querySelector("[data-test-action='delete-confirm-never']");
		assert(cancel, "Cancel must be rendered");
		assert(confirm, "the plain confirmation must be rendered");
		assert(never, "the skipping confirmation must be rendered");
		expect(cancel.textContent).toBe("Cancel");
		expect(confirm.textContent).toBe("Delete from this readlist");
		expect(never.textContent).toBe("Delete and skip future confirmations");
		expect([...doc.querySelectorAll(".confirm-popover__buttons button")].map((button) => button.getAttribute("data-test-action"))).toEqual([
			"delete-confirm-never",
			"delete-cancel",
			"delete-confirm",
		]);
		expect(cancel.getAttribute("type")).toBe("button");
		expect(cancel.getAttribute("popovertarget")).toBe("readlist-delete-confirm-abc123");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(cancel.classList.contains("btn--neutral")).toBe(true);
		expect(confirm.classList.contains("btn--primary")).toBe(true);
		expect(confirm.hasAttribute("name")).toBe(false);
		expect(never.getAttribute("name")).toBe("ack");
		expect(never.getAttribute("value")).toBe(DELETE_ACK_NEVER);
	});

	it("describes the skipping deletion by its consequence, on that control alone", () => {
		const doc = panelFor("/queue/abc123/delete");

		const never = doc.querySelector("[data-test-action='delete-confirm-never']");
		assert(never, "the skipping confirmation must be rendered");
		const helpId = never.getAttribute("aria-describedby");
		expect(helpId).toBe("readlist-delete-confirm-abc123-never-help");
		expect(doc.getElementById(helpId ?? "")?.textContent).toBe(
			"This also skips the question when you delete other articles from a readlist or the reader.",
		);
		expect(doc.querySelectorAll("[aria-describedby='readlist-delete-confirm-abc123-never-help']")).toHaveLength(1);
	});

	it("warns that the last saved copy's highlights and notes go for good", () => {
		const body = panelFor("/queue/abc123/delete").querySelector(".confirm-popover__body");
		assert(body, "the delete panel must explain the outcome");
		expect(body.textContent).toBe(
			"Removing your last saved copy can permanently delete its highlights and notes. Saving the article again won't restore them.",
		);
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
				confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", fallbackId: "confirm-remove-abc123", url: "/queue/abc123/delete" },
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
	it("opens on Cancel, so a second Enter leaves the article where it was", () => {
		const doc = panelFor("/queue/abc123/delete");

		expect(focusTargets(doc)).toEqual(["delete-cancel"]);
		expect(doc.querySelector("[popover][autofocus]")).toBeNull();
	});
});

describe("buildArticleDeletion", () => {
	it("asks first while the reader has not silenced the confirmation", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "?tab=done", acknowledged: false });

		expect(deletion).toEqual({
			articleId: "abc123",
			url: "/queue/abc123/delete?tab=done",
			confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", fallbackId: "confirm-remove-abc123", url: "/queue/abc123/delete?tab=done" },
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

	it("only shows the scoped removal control in the reader, with no account-wide delete confirmation", () => {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "?scope=hand-picked", acknowledged: false, removePick: true });
		expect(deletion.confirm).toBeUndefined();
		expect(renderDeleteMenuItems({ deletion, surface: "queue-card" })).toBe("");
		expect(renderDeleteMenuItems({ deletion, surface: "reader" })).toContain("Remove from Hand Picked");
	});

	it("opens the confirmation, or the in-page question by fragment, while the reader is still asked", () => {
		const doc = itemsFor({
			deletion: buildArticleDeletion({ articleId: "abc123", query: "", acknowledged: false }),
			surface: "queue-card",
		});

		const trigger = doc.querySelector("[data-test-action='delete']");
		const fallback = doc.querySelector("[data-test-action='delete-fallback']");
		assert(trigger, "the confirmation trigger must be rendered");
		assert(fallback, "the in-page fallback link must be rendered");
		expect(trigger.textContent).toBe("Delete from this readlist");
		expect(fallback.textContent).toBe("Delete from this readlist");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-delete-confirm-abc123");
		expect(fallback.tagName).toBe("A");
		expect(fallback.getAttribute("href")).toBe("#confirm-remove-abc123");
		expect(fallback.getAttribute("hx-boost")).toBe("false");
		expect(doc.querySelectorAll("form")).toHaveLength(0);
		expect(doc.querySelectorAll("button[type='submit']")).toHaveLength(0);
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
				confirm: { articleId: "abc123", popoverId: "readlist-delete-confirm-abc123", fallbackId: "confirm-remove-abc123", url: "/queue/abc123/delete" },
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

describe("renderDeleteFallback", () => {
	const confirm = {
		articleId: "1a2b",
		popoverId: "readlist-delete-confirm-1a2b",
		fallbackId: "confirm-remove-1a2b",
		url: "/queue/1a2b/delete?queue=work",
	};

	function fallbackOn(surface: "queue-card" | "reader", title = "Second of Two Similar Titles") {
		return parseHTML(`<div>${renderDeleteFallback({ confirm, surface, title })}</div>`).document;
	}

	it("asks the same question in a labelled section the menu reaches by fragment", () => {
		const doc = fallbackOn("queue-card");

		const section = doc.querySelector("section");
		assert(section, "the fallback must be a section");
		expect(section.id).toBe("confirm-remove-1a2b");
		expect(section.getAttribute("tabindex")).toBe("-1");
		expect(doc.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Remove this article from this readlist?",
		);
		expect(
			(section.getAttribute("aria-describedby") ?? "").split(" ").map((id) => doc.getElementById(id)?.textContent),
		).toEqual([
			"Second of Two Similar Titles",
			"Removing your last saved copy can permanently delete its highlights and notes. Saving the article again won't restore them.",
		]);
		expect(doc.querySelectorAll("[autofocus]")).toHaveLength(0);
	});

	it("reaches Cancel first, a fragment link back to the card's menu toggle that never submits", () => {
		const doc = fallbackOn("queue-card");

		const controls = [...doc.querySelectorAll("a, button")].map((control) => control.getAttribute("data-test-action"));
		expect(controls).toEqual(["delete-fallback-cancel", "delete-fallback-confirm", "delete-fallback-never"]);
		const cancel = doc.querySelector("[data-test-action='delete-fallback-cancel']");
		assert(cancel, "Cancel must be rendered");
		expect(cancel.getAttribute("href")).toBe("#article-menu-1a2b");
		expect(cancel.getAttribute("hx-boost")).toBe("false");
		expect(cancel.textContent).toBe("Cancel");
	});

	it("returns the reader's Cancel to the reader's menu toggle and mirrors the reader's heading", () => {
		const doc = fallbackOn("reader");

		expect(doc.querySelector("[data-test-action='delete-fallback-cancel']")?.getAttribute("href")).toBe(
			`#${READER_MENU_TOGGLE_ID}`,
		);
		expect(doc.getElementById("confirm-remove-1a2b-subject")?.getAttribute("data-text-from")).toBe("reader-article-title");
	});

	it("posts both explicit choices through the existing tracked deletion, and only one skips future questions", () => {
		const doc = fallbackOn("reader");

		const form = doc.querySelector("form");
		assert(form, "the fallback must post through a form");
		const action = new URL(form.getAttribute("action") ?? "", "https://internal.invalid");
		expect([action.pathname, action.searchParams.get("queue"), action.searchParams.get("utm_source")]).toEqual([
			"/queue/1a2b/delete",
			"work",
			"reader",
		]);
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:window:top");
		const never = doc.querySelector("[data-test-action='delete-fallback-never']");
		const plain = doc.querySelector("[data-test-action='delete-fallback-confirm']");
		assert(never && plain, "both submitters must be rendered");
		expect(plain.hasAttribute("name")).toBe(false);
		expect([never.getAttribute("name"), never.getAttribute("value")]).toEqual(["ack", DELETE_ACK_NEVER]);
		expect(doc.getElementById(never.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"This also skips the question when you delete other articles from a readlist or the reader.",
		);
	});

	it("escapes the title", () => {
		const doc = fallbackOn("queue-card", "<img src=x> & co");

		expect(doc.querySelectorAll("section img")).toHaveLength(0);
		expect(doc.getElementById("confirm-remove-1a2b-subject")?.textContent).toBe("<img src=x> & co");
	});
});

describe("renderDeletionDecisions", () => {
	function decisionsFor(acknowledged: boolean) {
		const deletion = buildArticleDeletion({ articleId: "abc123", query: "", acknowledged });
		return parseHTML(
			`<main>${renderDeletionDecisions({ deletion, surface: "queue-card", title: "A Saved Article" })}</main>`,
		).document;
	}

	it("keeps one popover and one in-page question per article, with ids no other article shares", () => {
		const doc = decisionsFor(false);

		const container = doc.getElementById("readlist-delete-decisions-abc123");
		assert(container, "the article's decisions must sit in their container");
		expect(container.querySelectorAll("[popover]")).toHaveLength(1);
		expect(container.querySelectorAll("section")).toHaveLength(1);
		const ids = [...doc.querySelectorAll("[id]")].map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(doc.querySelectorAll("form form")).toHaveLength(0);
	});

	it("still renders the empty container once the reader skips the question, so a later response can address it", () => {
		const doc = decisionsFor(true);

		const container = doc.getElementById("readlist-delete-decisions-abc123");
		assert(container, "the container must be rendered");
		expect(container.innerHTML).toBe("");
	});

	it("retires an article's decisions out of band by emptying its container", () => {
		const doc = parseHTML(`<div>${renderRetiredDeletionDecisionsOob("abc123")}</div>`).document;

		const container = doc.getElementById("readlist-delete-decisions-abc123");
		assert(container, "the retirement must address the container");
		expect(container.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(container.innerHTML).toBe("");
	});
});
