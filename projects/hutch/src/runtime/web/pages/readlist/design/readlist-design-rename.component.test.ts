import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { readlistRenamePath } from "../readlist.url";
import { readlistDesignRenamePopoverId, renderReadlistDesignRename } from "./readlist-design-rename.component";

const WORK = ReadlistSlugSchema.parse("work");

function panel(overrides: Partial<Parameters<typeof renderReadlistDesignRename>[0]> = {}): Document {
	const input = { slug: WORK, label: "Work Reading", ...overrides };
	return new JSDOM(`<div>${renderReadlistDesignRename(input)}</div>`).window.document;
}

describe("readlistDesignRenamePopoverId", () => {
	it("names the popover from the readlist slug", () => {
		expect(readlistDesignRenamePopoverId(WORK)).toBe("readlist-design-rename-work");
	});
});

describe("renderReadlistDesignRename", () => {
	it("opens on the popover id the nav's Edit trigger targets", () => {
		const doc = panel();

		const popover = doc.querySelector(".confirm-popover");
		assert(popover, "the rename panel must render");
		expect(popover.getAttribute("id")).toBe("readlist-design-rename-work");
	});

	it("titles the panel Edit readlist", () => {
		const doc = panel();

		const title = doc.getElementById("readlist-design-rename-work-title");
		assert(title, "the panel must carry its title");
		expect(title.textContent).toBe("Edit readlist");
	});

	it("marks its form so the design client script can find it", () => {
		const doc = panel();

		const form = doc.querySelector("form");
		assert(form, "the panel must post through a form");
		expect(form.hasAttribute("data-readlist-design-rename")).toBe(true);
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
		expect(cancel.getAttribute("popovertarget")).toBe("readlist-design-rename-work");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
	});

	it("posts to the readlist's rename route, tagged for funnel attribution", () => {
		const doc = panel();

		const form = doc.querySelector("form");
		assert(form, "the panel must post through a form");
		expect(form.getAttribute("action")).toBe(
			`${readlistRenamePath(WORK)}?feature=design&utm_source=queue-nav&utm_medium=internal&utm_content=rename-readlist`,
		);
	});
});
