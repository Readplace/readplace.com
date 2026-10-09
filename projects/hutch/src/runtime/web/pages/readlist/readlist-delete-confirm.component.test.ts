import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { parseHTML } from "linkedom";
import {
	type ReadlistDeleteDestination,
	readlistDeleteConfirmPopoverId,
	renderReadlistDeleteConfirm,
} from "./readlist-delete-confirm.component";

const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const PERSONAL = ReadlistSlugSchema.parse("e5f6a7b8");
const PLAIN_BODY = "This readlist will be permanently deleted. Articles saved in All will remain in your library.";
const MOVE_OR_DELETE_BODY =
	"Before deleting this readlist, choose whether to move its articles to another readlist or delete them.";

function panelFor(input: { holdsArticles: boolean; destinations: readonly ReadlistDeleteDestination[] }) {
	const { document } = parseHTML(
		`<div>${renderReadlistDeleteConfirm({
			slug: WORK,
			url: `/queue/queues/${WORK}/delete`,
			label: "Work Reading",
			destinations: input.destinations,
			holdsArticles: input.holdsArticles,
			illustrationHtml: "<svg data-test-trash-illustration></svg>",
		})}</div>`,
	);
	return document;
}

function movableArticles(): Document {
	return panelFor({ holdsArticles: true, destinations: [{ slug: PERSONAL, label: "Personal" }] });
}

function textOf(doc: Document, id: string): string | null {
	const element = doc.getElementById(id);
	assert(element, `the panel must render #${id}`);
	return element.textContent;
}

function formControls(doc: Document): (string | null)[] {
	const form = doc.querySelector("form");
	assert(form, "the confirmation must post through a form");
	return Array.from(
		form.querySelectorAll("select, button"),
		(control) => control.getAttribute("name") ?? control.getAttribute("data-test-action"),
	);
}

function commitOf(doc: Document): Element {
	const commit = doc.querySelector("[data-test-action='readlist-delete-confirm']");
	assert(commit, "the delete form must carry its commit");
	return commit;
}

describe("readlistDeleteConfirmPopoverId", () => {
	it("prefixes the slug so the id is a legal CSS ident, not just a legal HTML id", () => {
		expect(readlistDeleteConfirmPopoverId(WORK)).toBe("readlist-remove-confirm-a1b2c3d4");
	});
});

describe("renderReadlistDeleteConfirm", () => {
	it("asks the plain question when the readlist holds nothing to move", () => {
		const doc = panelFor({ holdsArticles: false, destinations: [{ slug: PERSONAL, label: "Personal" }] });

		expect(textOf(doc, "readlist-remove-confirm-a1b2c3d4-title")).toBe("Delete this readlist?");
		expect(textOf(doc, "readlist-remove-confirm-a1b2c3d4-body")).toBe(PLAIN_BODY);
		expect(formControls(doc)).toEqual(["readlist-delete-cancel", "readlist-delete-confirm"]);
	});

	it("asks the plain question when no other readlist could take the articles", () => {
		const doc = panelFor({ holdsArticles: true, destinations: [] });

		expect(textOf(doc, "readlist-remove-confirm-a1b2c3d4-title")).toBe("Delete this readlist?");
		expect(formControls(doc)).toEqual(["readlist-delete-cancel", "readlist-delete-confirm"]);
	});

	it("asks where the articles go when the readlist holds some and another readlist can take them", () => {
		const doc = movableArticles();

		expect(textOf(doc, "readlist-remove-confirm-a1b2c3d4-title")).toBe("Move or delete articles");
		expect(textOf(doc, "readlist-remove-confirm-a1b2c3d4-body")).toBe(MOVE_OR_DELETE_BODY);
		expect(formControls(doc)).toEqual(["migrate_to", "readlist-delete-cancel", "readlist-delete-confirm"]);
	});

	it("offers every other readlist first and deleting them last, so an untouched choice moves them", () => {
		const options = Array.from(movableArticles().querySelectorAll("[data-test-migrate-select] option"));

		expect(options.map((option) => option.getAttribute("value"))).toEqual(["e5f6a7b8", ""]);
		expect(options.map((option) => option.textContent)).toEqual(["Personal", "Nowhere, delete them too"]);
	});

	it("labels the dropdown for the field it names, so a screen reader reads the two together", () => {
		const doc = movableArticles();

		const select = doc.querySelector("[data-test-migrate-select]");
		assert(select, "the panel must render the destination dropdown");
		const label = doc.querySelector(`label[for="${select.getAttribute("id")}"]`);
		assert(label, "the dropdown must be labelled");
		expect(label.textContent).toBe("Move articles to");
		expect(select.getAttribute("name")).toBe("migrate_to");
	});

	it("commits with one wording whatever the reader picks", () => {
		const plain = panelFor({ holdsArticles: false, destinations: [] });

		expect([commitOf(plain).textContent, commitOf(movableArticles()).textContent]).toEqual([
			"Delete readlist",
			"Delete readlist",
		]);
		expect(commitOf(plain).getAttribute("type")).toBe("submit");
	});

	it("backs out through Cancel without posting", () => {
		for (const doc of [panelFor({ holdsArticles: false, destinations: [] }), movableArticles()]) {
			const cancel = doc.querySelector("[data-test-action='readlist-delete-cancel']");
			assert(cancel, "the panel must offer Cancel");
			expect(cancel.getAttribute("type")).toBe("button");
			expect(cancel.getAttribute("popovertarget")).toBe("readlist-remove-confirm-a1b2c3d4");
			expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		}
	});

	it("offers no close control of its own", () => {
		const header = movableArticles().querySelector(".confirm-popover__header");
		assert(header, "the panel must render its header");

		expect(
			Array.from(header.querySelectorAll("[data-test-action]"), (action) => action.getAttribute("data-test-action")),
		).toEqual([]);
	});

	it("names the readlist it deletes for tests that tell panels apart", () => {
		const panel = movableArticles().querySelector("[data-test-confirm-popover='readlist-delete']");
		assert(panel, "the panel must render");

		expect(panel.getAttribute("data-test-confirm-subject")).toBe("a1b2c3d4");
		expect(panel.getAttribute("id")).toBe("readlist-remove-confirm-a1b2c3d4");
	});

	it("names the readlist for a screen reader without repeating it on screen", () => {
		const doc = movableArticles();

		const lead = doc.getElementById("readlist-remove-confirm-a1b2c3d4-lead");
		assert(lead, "the panel must name the readlist it is about");
		expect(lead.textContent).toBe("Readlist: Work Reading");
		expect(lead.className).toBe("sr-only");
	});

	it("stamps the internal tracking the rail's delete control carries", () => {
		const form = movableArticles().querySelector("form");

		assert(form, "the confirmation must post through a form");
		const action = form.getAttribute("action") ?? "";
		expect(action).toContain("utm_source=queue-nav");
		expect(action).toContain("utm_medium=internal");
		expect(action).toContain("utm_content=queue-delete");
	});

	it("illustrates the panel with the artwork the caller supplies", () => {
		const doc = panelFor({ holdsArticles: false, destinations: [] });

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "the panel must render");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(true);
		expect(doc.querySelectorAll(".confirm-popover__illustration svg[data-test-trash-illustration]")).toHaveLength(1);
	});
});
