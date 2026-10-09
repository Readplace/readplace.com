import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import {
	READLIST_CREATE_POPOVER_ID,
	readlistCreateAction,
	renderReadlistCreate,
} from "./readlist-create.component";

function dialog(): Document {
	return new JSDOM(
		`<div>${renderReadlistCreate({
			popoverId: READLIST_CREATE_POPOVER_ID,
			key: "readlist-create",
			action: readlistCreateAction("/queue/queues?queue=work"),
		})}</div>`,
	).window.document;
}

describe("renderReadlistCreate", () => {
	it("opens on the popover id the rail's create row targets, keyed for its own test hooks", () => {
		const doc = dialog();

		const popover = doc.querySelector(".confirm-popover");
		assert(popover, "the create dialog must render");
		expect(popover.getAttribute("id")).toBe("readlist-create");
		expect(popover.getAttribute("data-test-confirm-popover")).toBe("readlist-create");
	});

	it("titles the dialog and offers Cancel then Create readlist, with no close control", () => {
		const doc = dialog();

		const title = doc.getElementById("readlist-create-title");
		assert(title, "the dialog must carry its title");
		expect(title.textContent).toBe("Create a new readlist");
		expect(
			[...doc.querySelectorAll(".confirm-popover [data-test-action]")].map((action) =>
				action.getAttribute("data-test-action"),
			),
		).toEqual(["readlist-create-cancel", "readlist-create-save"]);
		const commit = doc.querySelector('[data-test-action="readlist-create-save"]');
		assert(commit, "the dialog must offer its commit");
		expect(commit.querySelector(".readlist-name-form__commit-label")?.textContent).toBe("Create readlist");
	});

	it("opens on an empty name field the reader types into", () => {
		const doc = dialog();

		const input = doc.querySelector("[data-test-readlist-create-input]");
		assert(input, "the dialog must carry its name input");
		expect(input.id).toBe("readlist-create-name");
		expect(input.getAttribute("value")).toBe("");
		expect(input.getAttribute("placeholder")).toBe("Enter readlist name");
		expect(input.getAttribute("name")).toBe("label");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.hasAttribute("required")).toBe(true);
	});

	it("posts to the create route, tagged for funnel attribution, and carries its own failure text", () => {
		const doc = dialog();

		const form = doc.querySelector("form");
		assert(form, "the dialog must post through a form");
		expect(form.getAttribute("action")).toBe(
			"/queue/queues?queue=work&utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist",
		);
		expect(form.getAttribute("data-readlist-name-failure")).toBe("Couldn't create the readlist.");
	});
});
