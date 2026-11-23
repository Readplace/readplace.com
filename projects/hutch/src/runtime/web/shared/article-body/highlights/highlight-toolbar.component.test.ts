import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { renderHighlightToolbar, renderLocalHighlightToolbar } from "./highlight-toolbar.component";

function toolbarDocument(
	scope: Parameters<typeof renderHighlightToolbar>[0]["scope"] = {
		articleId: "abc",
		readlist: [],
		surface: [],
	},
	rowNoteOpen = false,
): Document {
	return new JSDOM(renderHighlightToolbar({ scope, rowNoteOpen, section: undefined, refusal: undefined })).window.document;
}

describe("renderHighlightToolbar", () => {
	it("renders a hidden toolbar holding Highlight then Add note, each naming its form and commit", () => {
		const doc = toolbarDocument();
		const toolbar = doc.querySelector("[data-test-highlight-toolbar]");

		expect(toolbar?.getAttribute("role")).toBe("toolbar");
		expect(toolbar?.getAttribute("aria-label")).toBe("Highlight selection");
		expect(toolbar?.hasAttribute("hidden")).toBe(true);
		const buttons = Array.from(toolbar?.querySelectorAll("button") ?? []);
		expect(
			buttons.map((button) => [
				button.textContent,
				button.getAttribute("data-highlight-commit"),
				doc.querySelector(button.getAttribute("data-highlight-form") ?? "")
					?.tagName,
			]),
		).toEqual([
			["Highlight", "submit", "FORM"],
			["Add note", "dialog", "FORM"],
		]);
		expect(Array.from(buttons[1].classList)).toEqual(Array.from(buttons[0].classList));
	});

	it("renders the note dialog beside the bar, posting the selection fields with answer=dialog to the tracked url", () => {
		const doc = toolbarDocument();
		const dialog = doc.getElementById("note-highlight-dialog");
		const form = dialog?.querySelector("form");
		const url = new URL(
			form?.getAttribute("action") ?? "",
			"https://readplace.com",
		);

		expect(dialog?.closest("[data-test-highlight-toolbar]")).toBeNull();
		expect(dialog?.getAttribute("data-test-confirm-popover")).toBe(
			"highlight-note",
		);
		expect(url.pathname).toBe("/queue/abc/highlights");
		expect(url.searchParams.get("utm_source")).toBe("highlight-toolbar");
		expect(url.searchParams.get("utm_content")).toBe("save-note");
		expect(
			Array.from(form?.querySelectorAll("input") ?? [], (input) => [
				input.name,
				input.value,
			]),
		).toEqual([
			["exact", ""],
			["start", ""],
			["end", ""],
			["origin", ""],
			["answer", "dialog"],
		]);
	});

	it("posts the create form to the tracked url with the passage fields", () => {
		const form = toolbarDocument().querySelector(
			"[data-test-highlight-create-form]",
		);
		const url = new URL(
			form?.getAttribute("action") ?? "",
			"https://readplace.com",
		);

		expect(url.pathname).toBe("/queue/abc/highlights");
		expect(url.searchParams.get("utm_source")).toBe("highlight-toolbar");
		expect(url.searchParams.get("utm_content")).toBe("highlight");
		expect(
			Array.from(form?.querySelectorAll("input") ?? [], (input) => input.name),
		).toEqual(["exact", "start", "end", "origin", "after"]);
		expect(form?.getAttribute("hx-target")).toBe("main");
		expect(form?.getAttribute("hx-select")).toBe("main");
		expect(form?.getAttribute("hx-swap")).toBe("outerHTML show:none");
	});

	it("keeps the readlist and the app surface on both forms, readlist then surface", () => {
		const doc = toolbarDocument({
			articleId: "abc",
			readlist: [["queue", "work"]],
			surface: [
				["platform", "android"],
				["shell", "app"],
			],
		});
		const create = doc
			.querySelector("[data-test-highlight-create-form]")
			?.getAttribute("action");
		const note = doc
			.querySelector("#note-highlight-dialog form")
			?.getAttribute("action");

		expect(create).toBe(
			"/queue/abc/highlights?queue=work&platform=android&shell=app&utm_source=highlight-toolbar&utm_medium=internal&utm_content=highlight",
		);
		expect(note).toBe(
			"/queue/abc/highlights?queue=work&platform=android&shell=app&utm_source=highlight-toolbar&utm_medium=internal&utm_content=save-note",
		);
	});

	it("keeps the app create form out of history so Back closes the reader", () => {
		const form = toolbarDocument({
			articleId: "abc",
			readlist: [],
			surface: [["platform", "ios"]],
		}).querySelector("[data-test-highlight-create-form]");

		expect(form?.getAttribute("hx-push-url")).toBe("false");
	});

	it("focuses the note dialog's field when no rail row's note form is open", () => {
		const note = toolbarDocument().querySelector(
			"#note-highlight-dialog [data-test-highlight-note-input]",
		);

		expect(note?.hasAttribute("autofocus")).toBe(true);
	});

	it("leaves the note dialog's field unfocused when a rail row's note form is open", () => {
		const note = toolbarDocument(undefined, true).querySelector(
			"#note-highlight-dialog [data-test-highlight-note-input]",
		);

		expect(note?.hasAttribute("autofocus")).toBe(false);
	});

	it("lets the web create form push history", () => {
		const form = toolbarDocument().querySelector(
			"[data-test-highlight-create-form]",
		);

		expect(form?.hasAttribute("hx-push-url")).toBe(false);
	});

	it("renders a hidden status that names its reader and the reader a check reads", () => {
		const doc = toolbarDocument({ articleId: "abc", readlist: [["readlist", "work"]], surface: [] });
		const status = doc.querySelector("[data-highlight-status]");

		expect(status?.getAttribute("data-highlight-reader")).toBe("abc:");
		expect(status?.getAttribute("data-highlight-check-url")).toBe("/queue/abc/view?readlist=work");
		expect(status?.hasAttribute("data-highlight-status-shown")).toBe(false);
		expect(status?.querySelector('[role="status"]')?.textContent?.trim()).toBe("");
		expect(status?.getAttribute("data-copy-saving")).toBe("Saving highlight");
		expect(
			Array.from(status?.querySelectorAll("button") ?? [], (button) => [button.textContent, button.hidden]),
		).toEqual([
			["Stop waiting", true],
			["Check highlight", true],
			["Try again", true],
		]);
	});

	it("shows a refusal in the status and keeps the section a check reads", () => {
		const doc = new JSDOM(
			renderHighlightToolbar({
				scope: { articleId: "abc", readlist: [], surface: [] },
				rowNoteOpen: false,
				section: 2,
				refusal: { code: "cancelled", message: "That highlight just changed; try again" },
			}),
		).window.document;
		const status = doc.querySelector("[data-highlight-status]");

		expect(status?.getAttribute("data-highlight-reader")).toBe("abc:2");
		expect(status?.getAttribute("data-highlight-check-url")).toBe("/queue/abc/view?section=2");
		expect(status?.getAttribute("data-highlight-refusal")).toBe("cancelled");
		expect(status?.hasAttribute("data-highlight-status-shown")).toBe(true);
		expect(doc.querySelector("[data-test-highlight-status]")?.textContent).toBe("That highlight just changed; try again");
	});
});

describe("renderLocalHighlightToolbar", () => {
	const doc = (): Document =>
		new JSDOM(renderLocalHighlightToolbar({ openedUrl: "/view/highlights/event" })).window.document;

	it("names the public event route as the opened beacon", () => {
		const toolbar = doc().querySelector("[data-test-highlight-toolbar]");
		assert(toolbar, "the toolbar renders");

		assert.equal(toolbar.getAttribute("data-highlight-opened-url"), "/view/highlights/event");
	});

	it("marks only Add note as a note trigger, so browsers without popovers hide it", () => {
		const page = doc();
		const addNote = page.querySelector('[data-test-action="add-note"]');
		const highlight = page.querySelector('[data-test-action="highlight"]');
		assert(addNote, "the Add note button renders");
		assert(highlight, "the Highlight button renders");

		assert.equal(addNote.classList.contains("highlight-note__trigger"), true);
		assert.equal(highlight.classList.contains("highlight-note__trigger"), false);
	});

	it("keeps the create form in the browser: a dialog-method form with no htmx or server action", () => {
		const form = doc().querySelector("[data-highlight-create-form]");
		assert(form, "the create form renders, so a sentence tap still finds it");

		assert.deepEqual(
			form.getAttributeNames().filter((name) => name.startsWith("hx-") || name === "action"),
			[],
		);
		assert.equal(form.getAttribute("method"), "dialog");
		assert.equal(form.getAttribute("data-highlight-local"), "create");
	});

	it("keeps the note form in the browser too, still carrying the passage fields and the note", () => {
		const form = doc().querySelector("#note-highlight-dialog form");
		assert(form, "the note dialog renders its form");

		assert.deepEqual(
			form.getAttributeNames().filter((name) => name.startsWith("hx-") || name === "action"),
			[],
		);
		assert.equal(form.getAttribute("method"), "dialog");
		assert.equal(form.getAttribute("data-highlight-local"), "create");
		assert.equal(form.hasAttribute("data-highlight-note-editor"), true);
		assert.deepEqual(
			Array.from(form.querySelectorAll("[name]")).map((field) => field.getAttribute("name")),
			["exact", "start", "end", "origin", "answer", "note"],
		);
	});

	it("renders no status for the local reader, which saves in the browser", () => {
		const doc = new JSDOM(renderLocalHighlightToolbar({ openedUrl: "/opened" })).window.document;
		expect(doc.querySelector("[data-highlight-status]")).toBeNull();
	});
});
