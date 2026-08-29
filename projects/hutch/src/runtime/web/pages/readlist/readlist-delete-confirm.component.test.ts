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

function panelFor(destinations: readonly ReadlistDeleteDestination[]) {
	const { document } = parseHTML(
		`<div>${renderReadlistDeleteConfirm({
			popoverId: readlistDeleteConfirmPopoverId(WORK),
			url: `/queue/queues/${WORK}/delete`,
			label: "Work Reading",
			destinations,
		})}</div>`,
	);
	return document;
}

function offeredDestinations(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-migrate-target]"), (option) =>
		option.getAttribute("data-test-migrate-target"),
	);
}

describe("readlistDeleteConfirmPopoverId", () => {
	it("prefixes the slug so the id is a legal CSS ident, not just a legal HTML id", () => {
		expect(readlistDeleteConfirmPopoverId(WORK)).toBe("readlist-remove-confirm-a1b2c3d4");
	});
});

describe("renderReadlistDeleteConfirm", () => {
	it("offers every other readlist the reader owns as somewhere the articles can go", () => {
		const doc = panelFor([{ slug: PERSONAL, label: "Personal" }]);

		expect(offeredDestinations(doc)).toEqual(["e5f6a7b8"]);
		const picker = doc.querySelector("[data-test-readlist-migrate]");
		assert(picker, "the panel must render the destination list");
		expect(picker.classList.contains("readlist-migrate--visible")).toBe(true);
	});

	it("withholds the picker when the reader has no second readlist to hand the articles to", () => {
		const doc = panelFor([]);

		expect(offeredDestinations(doc)).toEqual([]);
		const picker = doc.querySelector("[data-test-readlist-migrate]");
		assert(picker, "the panel must render the destination list");
		expect(picker.classList.contains("readlist-migrate--hidden")).toBe(true);
	});

	it("starts on leaving the articles behind, so confirming without a choice deletes as it always did", () => {
		const doc = panelFor([{ slug: PERSONAL, label: "Personal" }]);

		const options = Array.from(
			doc.querySelectorAll("[data-test-migrate-select] option"),
			(option) => option.getAttribute("value"),
		);
		expect(options).toEqual(["", "e5f6a7b8"]);
	});

	it("labels the dropdown for the field it names, so a screen reader reads the two together", () => {
		const doc = panelFor([{ slug: PERSONAL, label: "Personal" }]);

		const select = doc.querySelector("[data-test-migrate-select]");
		const label = doc.querySelector(".readlist-migrate__label");
		assert(select, "the panel must render the destination dropdown");
		assert(label, "the dropdown must be labelled");
		expect(label.getAttribute("for")).toBe(select.getAttribute("id"));
		expect(select.getAttribute("name")).toBe("migrate_to");
	});

	it("carries both wordings for the one confirm control, so picking a readlist renames it", () => {
		const doc = panelFor([{ slug: PERSONAL, label: "Personal" }]);

		const labels = Array.from(
			doc.querySelectorAll("[data-test-action='readlist-delete-confirm'] span"),
			(label) => label.textContent,
		);
		expect(labels).toEqual(["Confirm Deletion", "Move and Delete"]);
	});

	it("tells the reader the copies go with the readlist, and that another readlist can keep them", () => {
		const doc = panelFor([{ slug: PERSONAL, label: "Personal" }]);

		const body = doc.getElementById("readlist-remove-confirm-a1b2c3d4-body");
		assert(body, "the panel must say what deleting does");
		expect(body.textContent).toBe(
			"Deleting takes this readlist's copies with it. Move them to another readlist to keep them together, or leave them behind and keep only what All already holds.",
		);
	});

	it("drops the offer of another readlist from the wording when there is none", () => {
		const doc = panelFor([]);

		const body = doc.getElementById("readlist-remove-confirm-a1b2c3d4-body");
		assert(body, "the panel must say what deleting does");
		expect(body.textContent).toBe(
			"Deleting takes this readlist's copies with it. Anything you also saved in All stays there.",
		);
	});

	it("names the readlist for a screen reader without repeating it on screen", () => {
		const doc = panelFor([]);

		const lead = doc.getElementById("readlist-remove-confirm-a1b2c3d4-lead");
		assert(lead, "the panel must name the readlist it is about");
		expect(lead.textContent).toBe("Readlist: Work Reading");
		expect(lead.className).toBe("sr-only");
	});

	it("stamps the internal tracking the rail's delete control carries", () => {
		const form = panelFor([]).querySelector("form");

		assert(form, "the confirmation must post through a form");
		const action = form.getAttribute("action") ?? "";
		expect(action).toContain("utm_source=queue-nav");
		expect(action).toContain("utm_medium=internal");
		expect(action).toContain("utm_content=queue-delete");
	});
});
