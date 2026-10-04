import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { renderReadlistSave, toReadlistSaveDisplayModel } from "./readlist-save.component";

function cardDoc(overrides: Partial<Parameters<typeof toReadlistSaveDisplayModel>[0]> = {}): Document {
	return new JSDOM(renderReadlistSave(toReadlistSaveDisplayModel({
		filters: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 },
		accessIsReadOnly: false,
		saveTipState: "due",
		...overrides,
	}))).window.document;
}

function saveInput(doc: Document): HTMLInputElement {
	const input = doc.querySelector<HTMLInputElement>('input[name="url"]');
	assert(input, "the save card must render its link field");
	return input;
}

describe("readlist save card", () => {
	it("places the rejection message directly after the field and links the invalid input to it", () => {
		const doc = cardDoc({
			errors: [{ message: "Enter a valid article link." }],
			saveErrorCode: "malformed_url",
		});
		const input = saveInput(doc);
		const error = doc.querySelector("[data-test-save-error]");
		assert(error, "a rejected save must show its reason");
		expect(input.classList.contains("form-input")).toBe(true);
		expect(input.parentElement?.classList.contains("readlist-save__field")).toBe(true);
		expect(input.nextElementSibling).toBe(error);
		expect(error.textContent).toBe("Enter a valid article link.");
		expect(error.classList.contains("form-field__error")).toBe(true);
		expect(error.id).toBe("readlist-save-error");
		expect(error.getAttribute("role")).toBe("alert");
		expect(error.getAttribute("data-test-saveable-url-code")).toBe("malformed_url");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(input.getAttribute("aria-describedby")).toBe("readlist-save-error");
		expect(input.value).toBe("");
	});

	it("shows a save failure without attaching a validation code", () => {
		const doc = cardDoc({ errors: [{ message: "Couldn't save this article. Try again." }] });
		const error = doc.querySelector("[data-test-save-error]");
		assert(error, "a failed save must show its reason");
		expect(error.textContent).toBe("Couldn't save this article. Try again.");
		expect(error.hasAttribute("data-test-saveable-url-code")).toBe(false);
		expect(saveInput(doc).getAttribute("aria-invalid")).toBe("true");
	});

	it.each([undefined, [], [{ message: "" }]])("keeps an input with no error valid (%j)", (errors) => {
		const doc = cardDoc({ errors });
		const input = saveInput(doc);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(input.hasAttribute("aria-describedby")).toBe(false);
		expect(input.parentElement?.children.length).toBe(1);
	});

	it("reports an import as a neutral field message without marking or describing the input", () => {
		const doc = cardDoc({ importFlash: "3 of 3 links imported." });
		const input = saveInput(doc);
		const flash = doc.querySelector("[data-test-import-flash]");
		assert(flash, "the import must report its result");
		expect(input.nextElementSibling).toBe(flash);
		expect(flash.parentElement?.classList.contains("readlist-save__field")).toBe(true);
		expect(flash.className).toBe("form-field__message");
		expect(flash.textContent).toBe("3 of 3 links imported.");
		expect(flash.hasAttribute("id")).toBe(false);
		expect(flash.hasAttribute("role")).toBe(false);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(input.hasAttribute("aria-describedby")).toBe(false);
	});

	it("uses one message slot when a save rejection is present", () => {
		const doc = cardDoc({
			errors: [{ message: "Enter a valid article link." }],
			importFlash: "3 of 3 links imported.",
		});
		const input = saveInput(doc);
		expect(input.parentElement?.children.length).toBe(2);
		expect(input.nextElementSibling?.textContent).toBe("Enter a valid article link.");
	});

	it.each([true, false])("sets both controls' disabled state for read-only access (%s)", (accessIsReadOnly) => {
		const doc = cardDoc({ accessIsReadOnly });
		const button = doc.querySelector<HTMLButtonElement>('button[type="submit"]');
		assert(button, "the save action must render");
		expect(saveInput(doc).disabled).toBe(accessIsReadOnly);
		expect(button.disabled).toBe(accessIsReadOnly);
		expect(button.classList.contains("btn--primary")).toBe(true);
	});

	it("posts from a custom readlist to All with the form's tracking and enhancement attributes", () => {
		const doc = cardDoc({ filters: { readlist: ReadlistSlugSchema.parse("work"), tab: "queue", page: 1 } });
		const form = doc.querySelector('form[data-test-form="save-article"]');
		assert(form, "the save card must submit through a form");
		const action = form.getAttribute("action");
		assert(action, "the form must have a submission destination");
		const url = new URL(action, "https://readplace.com");
		expect(url.pathname).toBe("/queue/save");
		expect(url.searchParams.has("queue")).toBe(false);
		expect(url.searchParams.get("utm_source")).toBe("queue");
		expect(url.searchParams.get("utm_content")).toBe("save");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:#latest-saved:top");
		expect(form.getAttribute("hx-disabled-elt")).toBe(".readlist__save-btn");
		expect(form.getAttribute("hx-indicator")).toBe("closest form, .readlist-save-skeleton");
		expect(form.getAttribute("data-save-tip")).toBe("due");
	});

	it("prefills a pending link and marks the form for its existing auto-submit", () => {
		const doc = cardDoc({ saveUrl: "https://example.com/article?x=1&y=2" });
		expect(saveInput(doc).value).toBe("https://example.com/article?x=1&y=2");
		expect(saveInput(doc).closest("form")?.hasAttribute("data-auto-submit")).toBe(true);
	});

	it("shows escaped skipped links in the shared error alert, with the remaining count", () => {
		const doc = cardDoc({
			importFlash: "42 of 50 links imported. 8 couldn't be imported.",
			importSkipped: {
				entries: [{ url: '<script>alert("link")</script>', reasonLabel: "Invalid link" }],
				andMore: 3,
			},
		});
		const wrapper = doc.querySelector("[data-test-import-skipped]");
		assert(wrapper, "the save card must show skipped links");
		const alert = wrapper.querySelector('[data-test-alert="import-skipped"]');
		assert(alert, "skipped links must use the shared alert");
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(wrapper.hasAttribute("role")).toBe(false);
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe("Some links couldn't be imported");
		const row = alert.querySelector("[data-test-import-skipped-row]");
		assert(row, "the alert must show a row for the skipped link");
		expect(row.querySelector("[data-test-import-skipped-reason]")?.textContent).toBe("Invalid link");
		expect(row.firstElementChild?.textContent).toBe("Invalid link —");
		expect(row.querySelector("[data-test-import-skipped-url]")?.textContent).toBe('<script>alert("link")</script>');
		expect(row.querySelectorAll("script")).toHaveLength(0);
		expect(alert.querySelector("[data-test-import-skipped-more]")?.textContent).toBe("And 3 more.");
		expect(wrapper.previousElementSibling?.getAttribute("data-test-form")).toBe("save-article");
	});

	it("omits the remaining-count line when every skipped link fits", () => {
		const doc = cardDoc({ importSkipped: { entries: [{ url: "chrome://extensions/", reasonLabel: "Unsupported link" }], andMore: 0 } });
		const alert = doc.querySelector('[data-test-alert="import-skipped"]');
		assert(alert, "the skipped link must render in an alert");
		expect(alert.querySelectorAll("[data-test-import-skipped-row]")).toHaveLength(1);
		expect(alert.querySelectorAll("[data-test-import-skipped-more]")).toHaveLength(0);
	});

	it("renders the idle card without a callout when the skipped list is empty", () => {
		const doc = cardDoc({ importSkipped: { entries: [], andMore: 0 } });
		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must render");
		expect(Array.from(card.children, (child) => child.tagName)).toEqual(["H2", "P", "FORM"]);
	});
});
