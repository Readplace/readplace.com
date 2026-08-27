import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
	DELETE_ACK_NEVER,
	deleteConfirmPopoverId,
	renderDeleteConfirm,
} from "./delete-confirm.component";

function panelFor(url: string, title = "A Saved Article") {
	const { document } = parseHTML(
		`<div>${renderDeleteConfirm({
			confirm: { articleId: "abc123", popoverId: "queue-delete-confirm-abc123", url },
			title,
		})}</div>`,
	);
	return document;
}

describe("deleteConfirmPopoverId", () => {
	it("prefixes the hash so the id is a legal CSS ident, not just a legal HTML id", () => {
		const popoverId = deleteConfirmPopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("queue-delete-confirm-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
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
		expect(panel.getAttribute("id")).toBe("queue-delete-confirm-abc123");
	});

	it("names the article for a screen reader without repeating it on screen", () => {
		const doc = panelFor("/queue/abc123/delete", "The Pragmatic Programmer");

		const lead = doc.getElementById("queue-delete-confirm-abc123-lead");
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
		expect(confirm.textContent).toBe("Yes, delete it");
		expect(never.textContent).toBe("Yes, delete it and don't ask again");
		// Both submit the same form, so the second deletes as well as remembering.
		expect(confirm.closest("form")).toBe(never.closest("form"));
		expect(confirm.hasAttribute("name")).toBe(false);
		expect(never.getAttribute("name")).toBe("ack");
		expect(never.getAttribute("value")).toBe(DELETE_ACK_NEVER);
	});

	it("boosts the confirmation so deleting re-renders the listing in place", () => {
		const form = panelFor("/queue/abc123/delete").querySelector("form");

		assert(form, "the confirmation must post through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
	});
});
