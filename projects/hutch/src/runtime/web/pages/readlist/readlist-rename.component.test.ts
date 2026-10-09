import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { readlistRenamePath } from "./readlist.url";
import {
	readlistRenameAction,
	readlistRenamePopoverId,
	renderReadlistRename,
	renderReadlistRenameForm,
} from "./readlist-rename.component";

const WORK = ReadlistSlugSchema.parse("work");

function panel(overrides: Partial<Parameters<typeof renderReadlistRename>[0]> = {}): Document {
	const input = { slug: WORK, label: "Work Reading", ...overrides };
	return new JSDOM(`<div>${renderReadlistRename(input)}</div>`).window.document;
}

describe("readlistRenamePopoverId", () => {
	it("names the popover from the readlist slug", () => {
		expect(readlistRenamePopoverId(WORK)).toBe("readlist-rename-work");
	});
});

describe("renderReadlistRename", () => {
	it("opens on the popover id the nav's Edit trigger targets", () => {
		const doc = panel();

		const popover = doc.querySelector(".confirm-popover");
		assert(popover, "the rename panel must render");
		expect(popover.getAttribute("id")).toBe("readlist-rename-work");
	});

	it("titles the panel Edit readlist", () => {
		const doc = panel();

		const title = doc.getElementById("readlist-rename-work-title");
		assert(title, "the panel must carry its title");
		expect(title.textContent).toBe("Edit readlist");
	});

	it("marks its form so the design client script can find it", () => {
		const doc = panel();

		const form = doc.querySelector("form");
		assert(form, "the panel must post through a form");
		expect(form.hasAttribute("data-readlist-name-form")).toBe(true);
		expect(form.getAttribute("data-readlist-name-failure")).toBe("Couldn't rename the readlist.");
	});

	it("seeds the input with the readlist's current name and the server's length cap", () => {
		const doc = panel({ label: "Work Reading" });

		const input = doc.querySelector("[data-test-readlist-rename-input]");
		assert(input, "the rename input must render");
		expect(input.getAttribute("value")).toBe("Work Reading");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.getAttribute("name")).toBe("label");
	});

	it("draws the name field with the shared form-field look", () => {
		const doc = panel();

		const input = doc.querySelector("[data-test-readlist-rename-input]");
		assert(input, "the rename input must render");
		const label = doc.querySelector(`label[for="${input.id}"]`);
		assert(label, "the rename input must be labelled");
		expect(input.classList.contains("form-input")).toBe(true);
		expect(label.classList.contains("form-field__label")).toBe(true);
		expect(label.textContent).toBe("Readlist name");
	});

	it("commits with Save", () => {
		const doc = panel();

		const save = doc.querySelector('[data-test-action="readlist-rename-save"]');
		assert(save, "the panel must offer a Save control");
		expect(save.querySelector(".readlist-name-form__commit-label")?.textContent).toBe("Save");
	});

	it("describes the input by an error line that stays empty, and so hidden, until a refused rename fills it", () => {
		const doc = panel();

		const input = doc.querySelector("[data-test-readlist-rename-input]");
		assert(input, "the rename input must render");
		const error = doc.querySelector("[data-test-readlist-rename-error]");
		assert(error, "the rename form must carry its error line");
		expect(input.getAttribute("aria-describedby")).toBe(error.id);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(error.classList.contains("form-field__error")).toBe(true);
		expect(error.innerHTML).toBe("");
	});

	it("gives each readlist's error line its own id so two rename panels on one page never share one", () => {
		const errorIds = [WORK, ReadlistSlugSchema.parse("home")].map((slug) => {
			const error = panel({ slug }).querySelector("[data-test-readlist-rename-error]");
			assert(error, "the rename form must carry its error line");
			return error.id;
		});

		expect(new Set(errorIds).size).toBe(2);
	});

	it("hides the popover from the Cancel button without a page load", () => {
		const doc = panel();

		const cancel = doc.querySelector('[data-test-action="readlist-rename-cancel"]');
		assert(cancel, "the panel must offer a Cancel control");
		expect(cancel.getAttribute("popovertarget")).toBe("readlist-rename-work");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(cancel.classList.contains("btn--neutral")).toBe(true);
		expect(cancel.parentElement?.classList.contains("confirm-popover__buttons")).toBe(true);
		expect([...doc.querySelectorAll(".confirm-popover__header [data-test-action]")].map((action) => action.getAttribute("data-test-action"))).toEqual([]);
	});

	it("holds the same form the rename route re-renders when it refuses a name", () => {
		const html = renderReadlistRename({ slug: WORK, label: "Work Reading" });

		expect(html).toContain(
			renderReadlistRenameForm({ slug: WORK, action: readlistRenameAction(WORK), value: "Work Reading" }),
		);
	});

	it("posts to the readlist's rename route, tagged for funnel attribution", () => {
		const doc = panel();

		const form = doc.querySelector("form");
		assert(form, "the panel must post through a form");
		expect(form.getAttribute("action")).toBe(
			`${readlistRenamePath(WORK)}?utm_source=queue-nav&utm_medium=internal&utm_content=rename-readlist`,
		);
	});
});
