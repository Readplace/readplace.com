import { JSDOM } from "jsdom";
import { renderHighlightToolbar } from "./highlight-toolbar.component";

function toolbarDocument(
	scope: Parameters<typeof renderHighlightToolbar>[0]["scope"] = {
		articleId: "abc",
		readlist: [],
		surface: [],
	},
): Document {
	return new JSDOM(renderHighlightToolbar({ scope })).window.document;
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
		expect(buttons[1].classList.contains("highlight-note__trigger")).toBe(true);
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
		).toEqual(["exact", "start", "end", "origin"]);
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

	it("lets the web create form push history", () => {
		const form = toolbarDocument().querySelector(
			"[data-test-highlight-create-form]",
		);

		expect(form?.hasAttribute("hx-push-url")).toBe(false);
	});
});
