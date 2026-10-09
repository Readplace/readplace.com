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

	it("renders a list under the body and describes the panel by both", () => {
		const doc = renderPanel({ bodyItems: [
			{ label: "All", icon: "file" },
			{ label: "Work", icon: "folder" },
			{ label: "Later", icon: "folder" },
		] });

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-body thing-confirm-42-items",
		);
		const items = doc.getElementById("thing-confirm-42-items");
		assert(items, "the list must be rendered");
		expect(items.tagName).toBe("UL");
		expect([...items.querySelectorAll(".confirm-popover__item-label")].map((label) => label.textContent)).toEqual([
			"All",
			"Work",
			"Later",
		]);
		const rows = [...items.querySelectorAll(".confirm-popover__item")];
		expect(rows.map((row) => row.firstElementChild?.tagName)).toEqual(["svg", "svg", "svg"]);
		expect(rows.map((row) => row.querySelector("svg")?.getAttribute("aria-hidden"))).toEqual([
			"true", "true", "true",
		]);
	});

	it("escapes each item, so a readlist named after markup stays text", () => {
		const doc = renderPanel({ bodyItems: [{ label: '<img src=x onerror="alert(1)">', icon: "folder" }] });

		const items = doc.getElementById("thing-confirm-42-items");
		assert(items, "the list must be rendered");
		expect(items.querySelectorAll("img")).toHaveLength(0);
		expect(items.querySelector(".confirm-popover__item-label")?.textContent).toBe('<img src=x onerror="alert(1)">');
	});

	it("keeps the body spacing when a list follows it", () => {
		const withList = renderPanel({ bodyItems: [{ label: "All", icon: "file" }] });
		const withoutList = renderPanel();

		const introduced = withList.getElementById("thing-confirm-42-body");
		const alone = withoutList.getElementById("thing-confirm-42-body");
		assert(introduced, "the body must be rendered");
		assert(alone, "the body must be rendered");
		expect(introduced.className).toBe("confirm-popover__body");
		expect(alone.className).toBe("confirm-popover__body");
		expect(CONFIRM_POPOVER_STYLES).toContain("margin-bottom: 24px;");
	});

	it("draws the list as one bordered box split by hairlines, so each row reads as a thing the action touches", () => {
		const doc = renderPanel({ bodyItems: [{ label: "All", icon: "file" }, { label: "Work", icon: "folder" }] });

		const items = doc.getElementById("thing-confirm-42-items");
		assert(items, "the list must be rendered");
		const [first, second] = [...items.querySelectorAll("li")];
		assert(first, "the first item must be rendered");
		assert(second, "the second item must be rendered");
		expect(CONFIRM_POPOVER_STYLES).toContain(`.${items.className} {`);
		expect(CONFIRM_POPOVER_STYLES).toContain(`.${first.className} + .${second.className} {`);
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
			lead: "The Article Title",
			bodyItems: [{ label: "All", icon: "file" }],
		});

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-lead thing-confirm-42-body thing-confirm-42-items",
		);
	});

	it("describes the panel by lead then body when a lead names the subject", () => {
		const doc = renderPanel({ lead: "The Article Title" });

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-lead thing-confirm-42-body",
		);
	});

	it("keeps the subject in the accessible description without repeating it visibly", () => {
		const doc = renderPanel({ lead: "Article: The Article Title" });

		const lead = doc.getElementById("thing-confirm-42-lead");
		assert(lead, "lead must be rendered so screen readers still hear the subject");
		expect(lead.className).toBe("sr-only");
	});

	it("asks the question under a task title and describes the panel by it before the body", () => {
		const doc = renderPanel({
			title: "Edit readlist purpose",
			subheading: "What's this readlist for?",
		});

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		const subheadings = panel.querySelectorAll(".confirm-popover__subheading");
		expect(subheadings).toHaveLength(1);
		const [subheading] = subheadings;
		expect(subheading.tagName).toBe("H3");
		expect(subheading.id).toBe("thing-confirm-42-subheading");
		expect(subheading.textContent).toBe("What's this readlist for?");
		const before = subheading.previousElementSibling;
		assert(before, "the subheading must follow the header");
		expect(before.className).toBe("confirm-popover__header");
		const after = subheading.nextElementSibling;
		assert(after, "the body must follow the subheading");
		expect(after.id).toBe("thing-confirm-42-body");
		expect(panel.getAttribute("aria-describedby")).toBe(
			"thing-confirm-42-subheading thing-confirm-42-body",
		);
		expect(CONFIRM_POPOVER_STYLES).toContain(`.${subheading.className} {`);
	});

	it("renders no subheading when the title asks the question itself", () => {
		const doc = renderPanel();

		const panel = doc.querySelector(".confirm-popover");
		assert(panel, "panel must be rendered");
		expect(panel.querySelectorAll(".confirm-popover__subheading")).toHaveLength(0);
		expect(panel.getAttribute("aria-describedby")).toBe("thing-confirm-42-body");
	});

	it("names the decision on the panel and omits an unrequested close control", () => {
		const doc = renderPanel();

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must carry the decision key");
		expect(panel.getAttribute("data-test-confirm-popover")).toBe("thing");
		expect([...panel.querySelectorAll(".confirm-popover__header [data-test-action]")]).toEqual([]);
	});

	it("dismisses by targeting its own popover, so closing needs no JavaScript", () => {
		const doc = renderPanel({ close: {} });

		const dismiss = doc.querySelector(".confirm-popover__close");
		assert(dismiss, "dismiss control must be rendered");
		expect(dismiss.getAttribute("popovertarget")).toBe("thing-confirm-42");
		expect(dismiss.getAttribute("popovertargetaction")).toBe("hide");
		expect(dismiss.getAttribute("data-test-action")).toBe("thing-dismiss");
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
			close: { beaconUrl: "/thing/event?utm_content=dismissed&utm_medium=internal" },
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
		const doc = renderPanel({ close: {} });

		const panel = doc.querySelector("[data-test-confirm-popover]");
		assert(panel, "panel must be rendered");
		expect(panel.hasAttribute("data-beacon-url")).toBe(false);
		const dismiss = doc.querySelector("[data-test-action='thing-dismiss']");
		assert(dismiss, "the dismiss control must be rendered");
		expect(dismiss.hasAttribute("data-beacon-url")).toBe(false);
	});

	it("illustrates the panel when the caller supplies artwork, marked decorative", () => {
		const panel = renderPanel({ illustrationHtml: "<svg data-test-illustration></svg>" }).querySelector(
			".confirm-popover",
		);

		assert(panel, "panel must be rendered");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(true);
		const illustration = panel.querySelector(".confirm-popover__illustration");
		assert(illustration, "the illustration wrapper must be rendered");
		expect(illustration.getAttribute("aria-hidden")).toBe("true");
		expect(illustration.querySelectorAll("svg[data-test-illustration]")).toHaveLength(1);
	});

	it("ships the illustrated composition with the shell, so every page that illustrates a panel centres it the same way", () => {
		const panel = renderPanel({ illustrationHtml: "<svg data-test-illustration></svg>" }).querySelector(
			".confirm-popover",
		);

		assert(panel, "panel must be rendered");
		const illustration = panel.querySelector(".confirm-popover__illustration");
		assert(illustration, "the illustration wrapper must be rendered");
		expect(CONFIRM_POPOVER_STYLES).toContain(".confirm-popover--illustrated {");
		expect(CONFIRM_POPOVER_STYLES).toContain(".confirm-popover--illustrated .confirm-popover__header:has(.confirm-popover__close) {");
		expect(CONFIRM_POPOVER_STYLES).toContain(`.${illustration.className} {`);
		expect(CONFIRM_POPOVER_STYLES).toContain(".confirm-popover--illustrated .confirm-popover__buttons {");
	});

	it("omits the illustration modifier when the caller supplies no artwork", () => {
		const panel = renderPanel().querySelector(".confirm-popover");

		assert(panel, "panel must be rendered");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(false);
	});

	it("renders the caller's actions unescaped so each decision keeps its own controls", () => {
		const doc = renderPanel();

		const actions = doc.querySelector(".confirm-popover__actions");
		assert(actions, "caller actions must be rendered as markup");
		expect(actions.getAttribute("action")).toBe("/thing/delete");
		const submit = actions.querySelector("[data-test-action='thing-confirm']");
		assert(submit, "the caller's own submit control must survive rendering");
		expect(submit.textContent).toBe("Delete it");
		expect(CONFIRM_POPOVER_STYLES).toContain(".confirm-popover__buttons {");
	});
});
