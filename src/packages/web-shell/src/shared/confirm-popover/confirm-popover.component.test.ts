import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	CONFIRM_POPOVER_STYLES,
	renderConfirmPopover,
} from "./confirm-popover.component";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

const ACTIONS = `<form class="confirm-popover__actions" method="POST" action="/thing/delete"><button type="submit" data-test-action="thing-confirm">Delete it</button></form>`;

function renderPanel(overrides: Partial<Parameters<typeof renderConfirmPopover>[0]> = {}): Document {
	return parse(
		renderConfirmPopover({
			id: "thing-confirm-42",
			key: "thing",
			title: "Delete this thing?",
			body: "You will not get it back.",
			actionsHtml: ACTIONS,
			...overrides,
		}),
	);
}

describe("renderConfirmPopover", () => {
	it("renders an auto popover the browser can open from a popovertarget elsewhere on the page", () => {
		const panel = renderPanel().querySelector(".confirm-popover");

		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("popover")).toBe("auto");
		expect(panel.getAttribute("id")).toBe("thing-confirm-42");
		expect(panel.getAttribute("role")).toBe("dialog");
	});

	it("keeps the single-column width when the caller does not ask for a wide panel", () => {
		const panel = renderPanel().querySelector(".confirm-popover");

		assert(panel, "panel must be rendered");
		expect(panel.classList.contains("confirm-popover--wide")).toBe(false);
	});

	it("widens the panel when the caller lays its controls out side by side", () => {
		const panel = renderPanel({ wide: true }).querySelector(".confirm-popover");

		assert(panel, "panel must be rendered");
		expect(panel.classList.contains("confirm-popover--wide")).toBe(true);
	});

	it("labels the panel by its own title so a screen reader announces the decision", () => {
		const doc = renderPanel();

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		const titleId = panel.getAttribute("aria-labelledby");
		assert(titleId, "panel must be labelled");
		const title = doc.getElementById(titleId);
		assert(title, "aria-labelledby must resolve to an element in the panel");
		expect(title.textContent).toBe("Delete this thing?");
	});

	it("describes the panel by its body alone when there is no lead", () => {
		const doc = renderPanel();

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe("thing-confirm-42-body");
		const body = doc.getElementById("thing-confirm-42-body");
		assert(body, "the described element must exist");
		expect(body.textContent).toBe("You will not get it back.");
	});

	it("renders a bulleted list under the body and describes the panel by both", () => {
		const doc = renderPanel({ bodyItems: ["All", "Work", "Later"] });

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-body thing-confirm-42-items",
		);
		const items = doc.getElementById("thing-confirm-42-items");
		assert(items, "the list must be rendered");
		expect(items.tagName).toBe("UL");
		expect([...items.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
			"All",
			"Work",
			"Later",
		]);
	});

	it("escapes each item, so a readlist named after markup stays text", () => {
		const doc = renderPanel({ bodyItems: ['<img src=x onerror="alert(1)">'] });

		const items = doc.getElementById("thing-confirm-42-items");
		assert(items, "the list must be rendered");
		expect(items.querySelectorAll("img")).toHaveLength(0);
		expect(items.querySelector("li")?.textContent).toBe('<img src=x onerror="alert(1)">');
	});

	it("tightens the body above a list so the sentence reads as its introduction", () => {
		const withList = renderPanel({ bodyItems: ["All"] });
		const withoutList = renderPanel();

		const introduced = withList.getElementById("thing-confirm-42-body");
		const alone = withoutList.getElementById("thing-confirm-42-body");
		assert(introduced, "the body must be rendered");
		assert(alone, "the body must be rendered");
		expect(introduced.className).toBe(
			"confirm-popover__body confirm-popover__body--above-list",
		);
		expect(alone.className).toBe("confirm-popover__body");
		expect(CONFIRM_POPOVER_STYLES).toContain(".confirm-popover__body--above-list {");
		expect(CONFIRM_POPOVER_STYLES).toContain("list-style: disc;");
	});

	it("leaves the list out entirely when the body says all there is to say", () => {
		const doc = renderPanel();

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe("thing-confirm-42-body");
		expect(doc.querySelectorAll(".confirm-popover__items")).toHaveLength(0);
	});

	it("describes the panel by lead, body and list when all three are present", () => {
		const doc = renderPanel({
			lead: { text: "The Article Title", screenReaderOnly: true },
			bodyItems: ["All"],
		});

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-lead thing-confirm-42-body thing-confirm-42-items",
		);
	});

	it("describes the panel by lead then body when a lead names the subject", () => {
		const doc = renderPanel({
			lead: { text: "The Article Title", screenReaderOnly: false },
		});

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-lead thing-confirm-42-body",
		);
	});

	it("shows a visible lead when the subject is not already on screen", () => {
		const doc = renderPanel({
			lead: { text: "The Article Title", screenReaderOnly: false },
		});

		const lead = doc.getElementById("thing-confirm-42-lead");
		assert(lead, "lead must be rendered");
		expect(lead.className).toBe("confirm-popover__lead");
		expect(lead.textContent).toBe("The Article Title");
	});

	it("hides the lead from sighted readers when the subject is already on screen behind the panel", () => {
		const doc = renderPanel({
			lead: { text: "Article: The Article Title", screenReaderOnly: true },
		});

		const lead = doc.getElementById("thing-confirm-42-lead");
		assert(lead, "lead must be rendered so screen readers still hear the subject");
		expect(lead.className).toBe("sr-only");
	});

	it("names the decision on the panel and on its dismiss control from one key", () => {
		const doc = renderPanel();

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must carry the decision key");
		expect(panel.getAttribute("data-test-confirm-popover")).toBe("thing");
		const dismiss = doc.querySelector("[data-test-action]");
		assert(dismiss, "dismiss control must be rendered");
		expect(dismiss.getAttribute("data-test-action")).toBe("thing-dismiss");
	});

	it("dismisses by targeting its own popover, so closing needs no JavaScript", () => {
		const doc = renderPanel();

		const dismiss = doc.querySelector(".confirm-popover__close");
		assert(dismiss, "dismiss control must be rendered");
		expect(dismiss.getAttribute("popovertarget")).toBe("thing-confirm-42");
		expect(dismiss.getAttribute("popovertargetaction")).toBe("hide");
	});

	it("carries the subject when one page renders a panel per row", () => {
		const doc = renderPanel({ subject: "article-7" });

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article-7");
	});

	it("omits the subject attribute when the key alone identifies the panel", () => {
		const doc = renderPanel();

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must be rendered");
		expect(panel.hasAttribute("data-test-confirm-subject")).toBe(false);
	});

	it("ships a stylesheet that styles the block the shell actually renders", () => {
		const panel = renderPanel().querySelector(".confirm-popover");

		assert(panel, "panel must be rendered");
		expect(CONFIRM_POPOVER_STYLES).toContain(`.${panel.className} {`);
	});

	it("hands a caller the panel it opens and the control it closes with, which the shell owns", () => {
		const doc = renderPanel({
			openBeaconUrl: "/thing/event?utm_content=opened&utm_medium=internal",
			dismissBeaconUrl: "/thing/event?utm_content=dismissed&utm_medium=internal",
		});

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("data-beacon-url")).toBe(
			"/thing/event?utm_content=opened&utm_medium=internal",
		);
		const dismiss = doc.querySelector("[data-test-action='thing-dismiss']");
		assert(dismiss, "the dismiss control must be rendered");
		expect(dismiss.getAttribute("data-beacon-url")).toBe(
			"/thing/event?utm_content=dismissed&utm_medium=internal",
		);
	});

	it("leaves both beacon attributes off a panel whose caller asked for neither", () => {
		const doc = renderPanel();

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must be rendered");
		expect(panel.hasAttribute("data-beacon-url")).toBe(false);
		const dismiss = doc.querySelector("[data-test-action='thing-dismiss']");
		assert(dismiss, "the dismiss control must be rendered");
		expect(dismiss.hasAttribute("data-beacon-url")).toBe(false);
	});

	it("renders the caller's actions unescaped so each decision keeps its own controls", () => {
		const doc = renderPanel();

		const actions = doc.querySelector(".confirm-popover__actions");
		assert(actions, "caller actions must be rendered as markup");
		expect(actions.getAttribute("action")).toBe("/thing/delete");
		const submit = actions.querySelector("[data-test-action='thing-confirm']");
		assert(submit, "the caller's own submit control must survive rendering");
		expect(submit.textContent).toBe("Delete it");
	});
});
