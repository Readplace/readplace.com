import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import {
	type ArticleMoveViewModel,
	moveCreatePopoverId,
	moveDialogPopoverId,
	renderMoveCreateForm,
	renderMoveDialogs,
	renderMoveMenuItems,
} from "./move-dialog.component";

const IDEAS = ReadlistSlugSchema.parse("ideas-inspiration");
const FINANCE = ReadlistSlugSchema.parse("finance");
const WEEKEND = ReadlistSlugSchema.parse("weekend");

function moveFromIdeas(overrides?: Partial<ArticleMoveViewModel>): ArticleMoveViewModel {
	return {
		articleId: "abc123",
		popoverId: "readlist-move-abc123",
		mode: "move",
		from: IDEAS,
		url: "/queue/abc123/move?queue=ideas-inspiration",
		destinations: [
			{ slug: FINANCE, label: "Finance & Tax" },
			{ slug: WEEKEND, label: "Weekend" },
		],
		create: { popoverId: "readlist-create-move-abc123" },
		opens: "readlist-move-abc123",
		...overrides,
	};
}

function parse(html: string): Document {
	return new JSDOM(`<div id="root">${html}</div>`).window.document;
}

function dialogsFor(move: ArticleMoveViewModel, title = "A Saved Article"): Document {
	return parse(renderMoveDialogs({ move, title }).join("\n"));
}

function moveDialogOf(doc: Document): Element {
	const panel = doc.querySelector("[data-test-confirm-popover='move']");
	assert(panel, "a move panel must be rendered");
	return panel;
}

function createDialogOf(doc: Document): Element {
	const panel = doc.querySelector("[data-test-confirm-popover='readlist-create-move']");
	assert(panel, "a create panel must be rendered");
	return panel;
}

function glyph(name: "folder" | "folder-input" | "plus"): string {
	const svg = parse(iconSvg(name)).querySelector("svg");
	assert(svg, `the ${name} icon must be an svg drawing`);
	return svg.innerHTML;
}

function textOf(scope: ParentNode, selector: string): string | null | undefined {
	return scope.querySelector(selector)?.textContent;
}

function actionsOf(scope: ParentNode): (string | null)[] {
	return Array.from(scope.querySelectorAll("[data-test-action]"), (control) =>
		control.getAttribute("data-test-action"),
	);
}

describe("moveDialogPopoverId", () => {
	it("prefixes the hash so the id is a legal CSS ident, not just a legal HTML id", () => {
		const popoverId = moveDialogPopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("readlist-move-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
		expect(popoverId).toMatch(/^[a-zA-Z_-]/);
	});
});

describe("moveCreatePopoverId", () => {
	it("prefixes the hash so each card's create dialog has its own legal CSS ident", () => {
		const popoverId = moveCreatePopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("readlist-create-move-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
		expect(popoverId).toMatch(/^[a-zA-Z_-]/);
	});
});

describe("renderMoveDialogs", () => {
	it("renders the chooser and the create dialog for an article that has somewhere to go and room to create", () => {
		const doc = dialogsFor(moveFromIdeas());

		expect(
			Array.from(doc.querySelectorAll(".confirm-popover"), (panel) => [
				panel.getAttribute("data-test-confirm-popover"),
				panel.id,
			]),
		).toEqual([
			["move", "readlist-move-abc123"],
			["readlist-create-move", "readlist-create-move-abc123"],
		]);
	});

	it("renders only the create dialog when no readlist is left to choose", () => {
		const doc = dialogsFor(moveFromIdeas({ destinations: [], opens: "readlist-create-move-abc123" }));

		expect(Array.from(doc.querySelectorAll(".confirm-popover"), (panel) => panel.id)).toEqual([
			"readlist-create-move-abc123",
		]);
	});

	it("renders only the chooser when the reader has no room for another readlist", () => {
		const { create: _create, ...atTheCap } = moveFromIdeas();
		const doc = dialogsFor(atTheCap);

		expect(Array.from(doc.querySelectorAll(".confirm-popover"), (panel) => panel.id)).toEqual([
			"readlist-move-abc123",
		]);
	});

	it("asks where to move an article that sits in a custom readlist", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas()));

		expect(textOf(panel, ".confirm-popover__title")).toBe("Move to another readlist");
		expect(textOf(panel, ".confirm-popover__body")).toBe(
			"Choose where you'd like to move this article. It will be removed from its current readlist and added to the selected one.",
		);
		expect(textOf(panel, "[data-test-action='move-confirm']")).toBe("Move");
	});

	it("asks which readlist to add an article to on All, which keeps it", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas({ mode: "add" })));

		expect(textOf(panel, ".confirm-popover__title")).toBe("Add to a readlist");
		expect(textOf(panel, ".confirm-popover__body")).toBe(
			"Choose a readlist for this article. It also stays in All, which keeps everything you save.",
		);
		expect(textOf(panel, "[data-test-action='move-confirm']")).toBe("Add");
	});

	it("opens on the article id so one page of cards keeps its panels apart", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas()));

		expect(panel.getAttribute("id")).toBe("readlist-move-abc123");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("abc123");
	});

	it("names the article for a screen reader without repeating it on screen", () => {
		const lead = dialogsFor(moveFromIdeas(), "The Pragmatic Programmer").getElementById("readlist-move-abc123-lead");

		assert(lead, "the panel must name the article it is about");
		expect(lead.textContent).toBe("Article: The Pragmatic Programmer");
		expect(lead.className).toBe("sr-only");
	});

	it("offers one required, unchecked radio named to for each destination, in the order given", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas()));

		expect(
			Array.from(panel.querySelectorAll("input[type='radio']"), (radio) => ({
				name: radio.getAttribute("name"),
				value: radio.getAttribute("value"),
				required: radio.hasAttribute("required"),
				checked: radio.hasAttribute("checked"),
			})),
		).toEqual([
			{ name: "to", value: "finance", required: true, checked: false },
			{ name: "to", value: "weekend", required: true, checked: false },
		]);
		expect(
			Array.from(panel.querySelectorAll("[data-test-move-destination]"), (row) => [
				row.getAttribute("data-test-move-destination"),
				row.querySelector(".readlist-row__label")?.textContent,
			]),
		).toEqual([
			["finance", "Finance & Tax"],
			["weekend", "Weekend"],
		]);
	});

	it("makes each whole row the radio's label, so a click anywhere on it chooses that readlist", () => {
		const rows = Array.from(moveDialogOf(dialogsFor(moveFromIdeas())).querySelectorAll("[data-test-move-destination]"));

		expect(rows.map((row) => row.tagName.toLowerCase())).toEqual(["label", "label"]);
		expect(rows.map((row) => row.querySelector("input[type='radio']")?.getAttribute("value"))).toEqual([
			"finance",
			"weekend",
		]);
	});

	it("draws each destination with the custom readlist glyph", () => {
		const rows = Array.from(moveDialogOf(dialogsFor(moveFromIdeas())).querySelectorAll("[data-test-move-destination]"));

		expect(rows.map((row) => row.querySelector(".readlist-row__main > svg")?.innerHTML)).toEqual([
			glyph("folder"),
			glyph("folder"),
		]);
	});

	it("groups the destinations under a legend that only a screen reader announces", () => {
		const legend = moveDialogOf(dialogsFor(moveFromIdeas())).querySelector("fieldset > legend");

		assert(legend, "the destinations must be grouped under a legend");
		expect(legend.textContent).toBe("Readlists");
		expect(legend.className).toBe("sr-only");
	});

	it("posts the readlist the article is moving from", () => {
		const form = moveDialogOf(dialogsFor(moveFromIdeas())).querySelector("[data-test-form='readlist-move']");

		assert(form, "the dialog must post through a form");
		expect(
			Array.from(form.querySelectorAll("input[type='hidden']"), (input) => [
				input.getAttribute("name"),
				input.getAttribute("value"),
			]),
		).toEqual([["from", "ideas-inspiration"]]);
	});

	it("closes the list with a create row that opens the article's create dialog", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas()));

		const create = panel.querySelector("[data-test-action='move-create']");
		assert(create, "the list must offer to create a readlist");
		expect(create.getAttribute("type")).toBe("button");
		expect(create.getAttribute("popovertarget")).toBe("readlist-create-move-abc123");
		expect(create.getAttribute("aria-haspopup")).toBe("dialog");
		expect(create.textContent).toBe("Create a readlist");
		expect(create.querySelector("svg")?.innerHTML).toBe(glyph("plus"));
		expect(actionsOf(panel)).toEqual(["move-create", "move-cancel", "move-confirm"]);
	});

	it("ends the list at the last destination when the reader has no room for another readlist", () => {
		const { create: _create, ...atTheCap } = moveFromIdeas();
		const panel = moveDialogOf(dialogsFor(atTheCap));

		expect(actionsOf(panel)).toEqual(["move-cancel", "move-confirm"]);
	});

	it("dismisses with Cancel and commits with the primary button, with no close control", () => {
		const panel = moveDialogOf(dialogsFor(moveFromIdeas()));

		const cancel = panel.querySelector("[data-test-action='move-cancel']");
		const commit = panel.querySelector("[data-test-action='move-confirm']");
		assert(cancel, "the dialog must offer Cancel");
		assert(commit, "the dialog must offer the commit");
		expect(Array.from(panel.querySelectorAll(".confirm-popover__header button"))).toEqual([]);
		expect(cancel.textContent).toBe("Cancel");
		expect(cancel.getAttribute("type")).toBe("button");
		expect(cancel.getAttribute("popovertarget")).toBe("readlist-move-abc123");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(cancel.classList.contains("btn--neutral")).toBe(true);
		expect(commit.getAttribute("type")).toBe("submit");
		expect(commit.classList.contains("btn--primary")).toBe(true);
		expect(cancel.parentElement?.classList.contains("confirm-popover__buttons")).toBe(true);
	});

	it("stamps the card's tracking on the move and keeps the return query", () => {
		const form = moveDialogOf(dialogsFor(moveFromIdeas())).querySelector("[data-test-form='readlist-move']");

		assert(form, "the dialog must post through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			"/queue/abc123/move?queue=ideas-inspiration&utm_source=queue-card&utm_medium=internal&utm_content=move",
		);
	});

	it("boosts the move so it re-renders the listing in place without scrolling", () => {
		const form = moveDialogOf(dialogsFor(moveFromIdeas())).querySelector("[data-test-form='readlist-move']");

		assert(form, "the dialog must post through a form");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
	});

	it("posts the create dialog's name to the move route, tagged create-and-move, with the readlist the article leaves", () => {
		const form = createDialogOf(dialogsFor(moveFromIdeas())).querySelector("form");

		assert(form, "the create dialog must post through a form");
		const action =
			"/queue/abc123/move?queue=ideas-inspiration&utm_source=queue-card&utm_medium=internal&utm_content=create-and-move";
		expect(form.getAttribute("action")).toBe(action);
		expect(form.getAttribute("hx-post")).toBe(action);
		expect(
			[...form.children]
				.slice(0, 2)
				.map((child) => [child.tagName.toLowerCase(), child.getAttribute("name"), child.getAttribute("value")]),
		).toEqual([
			["input", "from", "ideas-inspiration"],
			["label", null, null],
		]);
	});

	it("gives each card's create dialog its own name field id", () => {
		const input = createDialogOf(dialogsFor(moveFromIdeas())).querySelector("input[name='label']");

		assert(input, "the create dialog must carry its name field");
		expect(input.id).toBe("readlist-create-move-abc123-name");
		expect(input.getAttribute("data-test-readlist-create-move-input")).toBe("");
	});

	it("holds the same form the move route re-renders when it refuses a name", () => {
		const move = moveFromIdeas();
		const doc = dialogsFor(move);
		const refused = parse(
			renderMoveCreateForm({
				articleId: "abc123",
				action:
					"/queue/abc123/move?queue=ideas-inspiration&utm_source=queue-card&utm_medium=internal&utm_content=create-and-move",
				from: IDEAS,
				value: "All",
				error: "Pick a name other than All, the readlist that holds every save.",
			}),
		);

		const dialogForm = createDialogOf(doc).querySelector("form");
		const refusedForm = refused.querySelector("form");
		assert(dialogForm && refusedForm, "both forms must render");
		const shape = (form: Element) => ({
			action: form.getAttribute("action"),
			hxPost: form.getAttribute("hx-post"),
			key: form.getAttribute("data-test-form"),
			inputId: form.querySelector("input[name='label']")?.id,
			hidden: form.querySelector("input[type='hidden']")?.getAttribute("value"),
			cancelTarget: form.querySelector("[data-test-action='readlist-create-move-cancel']")?.getAttribute("popovertarget"),
		});
		expect(shape(refusedForm)).toEqual(shape(dialogForm));
		expect(refusedForm.querySelector("input[name='label']")?.getAttribute("value")).toBe("All");
		expect(textOf(refusedForm, "[data-readlist-name-error]")).toBe(
			"Pick a name other than All, the readlist that holds every save.",
		);
	});
});

describe("renderMoveMenuItems", () => {
	function itemsFor(move: ArticleMoveViewModel): Element {
		const root = parse(renderMoveMenuItems({ move })).getElementById("root");
		assert(root, "the menu items must render");
		return root;
	}

	it("opens the dialog from a Move to readlist item drawn with folder-input", () => {
		const trigger = itemsFor(moveFromIdeas()).querySelector("[data-test-action='move']");

		assert(trigger, "the menu must offer the move");
		expect(trigger.tagName.toLowerCase()).toBe("button");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-move-abc123");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("title")).toBe("Move to readlist");
		expect(trigger.textContent).toBe("Move to readlist");
		expect(trigger.querySelector("svg")?.innerHTML).toBe(glyph("folder-input"));
		expect(trigger.classList.contains("readlist-article__confirm-trigger")).toBe(true);
	});

	it("names the item Add to readlist on All", () => {
		const trigger = itemsFor(moveFromIdeas({ mode: "add" })).querySelector("[data-test-action='move']");

		assert(trigger, "the menu must offer the add");
		expect(trigger.textContent).toBe("Add to readlist");
		expect(trigger.getAttribute("title")).toBe("Add to readlist");
	});

	it("opens the create dialog straight from the item when no readlist is left to choose", () => {
		const items = itemsFor(moveFromIdeas({ destinations: [], opens: "readlist-create-move-abc123" }));

		const trigger = items.querySelector("[data-test-action='move']");
		assert(trigger, "the menu must offer the move");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-create-move-abc123");
		expect(actionsOf(items)).toEqual(["move"]);
	});

	it("puts a no-popover fallback ahead of the trigger that posts the same move", () => {
		const items = itemsFor(moveFromIdeas());

		expect(Array.from(items.children, (child) => child.tagName.toLowerCase())).toEqual(["form", "button"]);
		const fallback = items.children[0];
		expect(fallback.classList.contains("readlist-article__fallback")).toBe(true);
		expect(fallback.getAttribute("method")).toBe("POST");
		expect(fallback.getAttribute("action")).toBe(
			"/queue/abc123/move?queue=ideas-inspiration&utm_source=queue-card&utm_medium=internal&utm_content=move",
		);
		expect(fallback.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(fallback.querySelector("input[type='hidden'][name='from']")?.getAttribute("value")).toBe(
			"ideas-inspiration",
		);
		expect(actionsOf(items)).toEqual(["move-fallback", "move"]);
	});

	it("lists the same destinations in the fallback select, inside the shared select box", () => {
		const select = itemsFor(moveFromIdeas()).querySelector("select[data-test-move-select]");

		assert(select, "the fallback must offer a select");
		expect(select.getAttribute("name")).toBe("to");
		expect(select.classList.contains("form-input__control")).toBe(true);
		expect(select.parentElement?.classList.contains("form-input--select")).toBe(true);
		expect(
			Array.from(select.querySelectorAll("option"), (option) => [option.getAttribute("value"), option.textContent]),
		).toEqual([
			["finance", "Finance & Tax"],
			["weekend", "Weekend"],
		]);
	});

	it("labels the fallback select per card so each card's field has its own id", () => {
		const items = itemsFor(moveFromIdeas());

		const label = items.querySelector(".form-field__label");
		assert(label, "the fallback select must be labelled");
		expect(label.textContent).toBe("Move to");
		expect(label.getAttribute("for")).toBe("readlist-move-select-abc123");
		expect(items.querySelector("select")?.getAttribute("id")).toBe("readlist-move-select-abc123");
		expect(textOf(items, "[data-test-action='move-fallback']")).toBe("Move");
	});

	it("labels the fallback for an add on All", () => {
		const items = itemsFor(moveFromIdeas({ mode: "add" }));

		expect(items.querySelector(".form-field__label")?.textContent).toBe("Add to");
		expect(textOf(items, "[data-test-action='move-fallback']")).toBe("Add");
	});
});
