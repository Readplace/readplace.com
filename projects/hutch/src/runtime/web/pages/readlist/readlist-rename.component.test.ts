import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { readlistRenamePath } from "./readlist.url";
import { readlistRenamePopoverId, renderReadlistRename } from "./readlist-rename.component";

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
		expect(form.hasAttribute("data-readlist-rename")).toBe(true);
	});

	it("seeds the input with the readlist's current name and the server's length cap", () => {
		const doc = panel({ label: "Work Reading" });

		const input = doc.querySelector("[data-test-readlist-rename-input]");
		assert(input, "the rename input must render");
		expect(input.getAttribute("value")).toBe("Work Reading");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.getAttribute("name")).toBe("label");
	});

	it("hides the popover from the Cancel button without a page load", () => {
		const doc = panel();

		const cancel = doc.querySelector('[data-test-action="readlist-rename-cancel"]');
		assert(cancel, "the panel must offer a Cancel control");
		expect(cancel.getAttribute("popovertarget")).toBe("readlist-rename-work");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
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
