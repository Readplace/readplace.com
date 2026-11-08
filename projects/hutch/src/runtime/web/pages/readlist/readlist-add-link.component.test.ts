import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import { renderAddLinkForm, renderReadlistAddLink, renderReadlistSaveFeedback } from "./readlist-add-link.component";

const OFFER: UpgradeOffer = { popoverId: "subscribe-plans", plansPath: "/account/plans", checkedPlan: "monthly" };
const SAVE_TIP_HTML = `<div id="save-tip" popover="auto" data-test-confirm-popover="save-tip"><button type="button" autofocus>Continue with URL</button></div>`;

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function addLink(overrides: Partial<Parameters<typeof renderReadlistAddLink>[0]> = {}) {
	return renderReadlistAddLink({
		filters: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 },
		accessIsReadOnly: false,
		offer: undefined,
		saveTip: { state: "due", html: SAVE_TIP_HTML },
		...overrides,
	});
}

function addLinkDoc(overrides: Partial<Parameters<typeof renderReadlistAddLink>[0]> = {}): Document {
	const rendered = addLink(overrides);
	return parse(`${rendered.pendingHtml}${rendered.controlHtml}${rendered.dialogHtml}`);
}

function element<T extends Element = Element>(doc: Document | Element, selector: string): T {
	const found = doc.querySelector<T>(selector);
	assert(found, `${selector} must be rendered`);
	return found;
}

function formDoc(overrides: Partial<Parameters<typeof renderAddLinkForm>[0]> = {}): Document {
	return parse(
		renderAddLinkForm({
			action: "/queue/save?utm_source=queue",
			value: "",
			saveTipState: "seen",
			accessIsReadOnly: false,
			autoSubmit: false,
			autofocus: true,
			...overrides,
		}),
	);
}

describe("Add article", () => {
	it("offers a neutral + Article button that opens the dialog", () => {
		const doc = addLinkDoc();

		const trigger = element(doc, '[data-test-action="add-link"]');
		expect(trigger.getAttribute("popovertarget")).toBe("add-link");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.classList.contains("btn--neutral")).toBe(true);
		expect(trigger.textContent).toBe("Article");
	});

	it("titles the dialog and tells the reader where the link is saved", () => {
		const doc = addLinkDoc();

		const dialog = element(doc, "#add-link");
		expect(dialog.getAttribute("popover")).toBe("auto");
		expect(dialog.getAttribute("role")).toBe("dialog");
		expect(element(doc, "#add-link-title").textContent).toBe("Add article");
		expect(element(doc, "#add-link-body").textContent).toBe(
			"Paste a link, or drop a file: a bookmarks export to review, or a DRM-free EPUB to read.",
		);
	});

	it("opens the dialog on its labelled, empty article link field", () => {
		const doc = addLinkDoc();

		const dialog = element(doc, "#add-link");
		expect(dialog.hasAttribute("autofocus")).toBe(false);
		const input = element<HTMLInputElement>(dialog, "input[autofocus]");
		expect(input.name).toBe("url");
		expect(input.type).toBe("url");
		expect(input.value).toBe("");
		expect(element(doc, `label[for="${input.id}"]`).textContent).toBe("Article link");
	});

	it("offers Link and File as underline tabs, Link chosen, in a named radio group", () => {
		const doc = addLinkDoc();

		const group = element(doc, '#add-link [role="radiogroup"]');
		expect(group.classList.contains("underline-tabs")).toBe(true);
		expect(group.getAttribute("aria-label")).toBe("Add from");
		const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		expect(radios.map((radio) => [radio.name, radio.value, radio.checked])).toEqual([
			["add-article-mode", "link", true],
			["add-article-mode", "file", false],
		]);
		const labels = radios.map((radio) => radio.closest("label.underline-tabs__tab")?.querySelector(".underline-tabs__label"));
		expect(labels.map((label) => [label?.getAttribute("data-widest"), label?.textContent])).toEqual([
			["Link", "Link"],
			["File", "File"],
		]);
		expect(element(doc, '[data-test-add-article-panel="link"] [data-test-form="save-article"]').id).toBe("add-link-form");
		expect(element(doc, '[data-test-add-article-panel="file"] [data-test-form="upload-file"]').id).toBe("add-article-upload-form");
	});

	it("closes the dialog with one footer holding Cancel and a Send for each tab, each submitting its own form", () => {
		const doc = addLinkDoc();

		const dialog = element(doc, "#add-link");
		const footers = dialog.querySelectorAll(".confirm-popover__buttons");
		expect(footers).toHaveLength(1);
		const footer = footers[0];
		expect(footer.closest("form")).toBeNull();
		const cancel = element(footer, '[data-test-action="add-link-cancel"]');
		expect(cancel.getAttribute("popovertarget")).toBe("add-link");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(cancel.getAttribute("type")).toBe("button");
		const linkSend = element(footer, '[data-test-action="add-link-save"]');
		expect(linkSend.getAttribute("type")).toBe("submit");
		expect(linkSend.getAttribute("form")).toBe("add-link-form");
		expect(linkSend.id).toBe("add-link-save");
		expect(linkSend.classList.contains("readlist__save-btn")).toBe(true);
		expect(element(linkSend, ".readlist__save-btn-label").textContent).toBe("Send");
		expect(element(linkSend, ".readlist__save-btn-saving").textContent).toBe("Sending…");
		const fileSend = element(footer, '[data-test-action="add-article-upload-send"]');
		expect(fileSend.getAttribute("type")).toBe("submit");
		expect(fileSend.getAttribute("form")).toBe("add-article-upload-form");
		expect(fileSend.textContent).toBe("Send");
		expect(dialog.querySelectorAll("form .confirm-popover__buttons, form button")).toHaveLength(0);
		expect(dialog.querySelector(".upload-dropzone__submit")).toBeNull();
	});

	it("keeps a chosen file waiting for Send", () => {
		const doc = addLinkDoc();

		expect(element(doc, '[data-test-form="upload-file"]').getAttribute("data-upload-on-choose")).toBe("false");
	});

	it("nests the save advice inside the dialog, after the form rather than inside it", () => {
		const doc = addLinkDoc();

		const tip = element(doc, "#add-link #save-tip");
		expect(tip.parentElement?.id).toBe("add-link");
		expect(element(doc, '#add-link [data-test-form="save-article"]').getAttribute("data-save-tip")).toBe("due");
	});

	it("carries the advice state the session has reached", () => {
		const doc = addLinkDoc({ saveTip: { state: "seen", html: SAVE_TIP_HTML } });

		expect(element(doc, '[data-test-form="save-article"]').getAttribute("data-save-tip")).toBe("seen");
	});

	it("posts from a custom readlist to All as a dialog form whose answer swaps the form", () => {
		const doc = addLinkDoc({ filters: { readlist: ReadlistSlugSchema.parse("work"), tab: "queue", page: 1 } });

		const form = element(doc, '[data-test-form="save-article"]');
		const action = form.getAttribute("action");
		assert(action, "the form must have a submission destination");
		const url = new URL(action, "https://readplace.com");
		expect(url.pathname).toBe("/queue/save");
		expect(url.searchParams.has("queue")).toBe(false);
		expect(url.searchParams.get("utm_source")).toBe("queue");
		expect(url.searchParams.get("utm_content")).toBe("save");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-post")).toBe(action);
		expect(form.getAttribute("hx-target")).toBe("this");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(form.getAttribute("hx-sync")).toBe("this:drop");
		expect(form.getAttribute("hx-disabled-elt")).toBe("#add-link-save");
		expect(form.getAttribute("hx-indicator")).toBe("closest form, .readlist-save-skeleton, #add-link-save");
		expect(doc.querySelectorAll(form.getAttribute("hx-disabled-elt") ?? "")).toHaveLength(1);
		expect(form.getAttribute("data-save-link-failure")).toBe("Couldn't save the link.");
		expect(form.hasAttribute("data-auto-submit")).toBe(false);
	});

	it("offers the same save as a disclosure for browsers without popovers", () => {
		const doc = addLinkDoc();

		const fallback = element(doc, "details[data-test-add-link-fallback]");
		expect(element(fallback, "summary").textContent).toBe("Article");
		const form = element(fallback, '[data-test-form="save-article-fallback"]');
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(element(doc, '[data-test-form="save-article"]').getAttribute("action"));
		expect(form.getAttribute("hx-boost")).toBe("false");
		const input = element<HTMLInputElement>(form, 'input[name="url"]');
		expect(element(doc, `label[for="${input.id}"]`).textContent).toBe("Article link");
		expect(element(form, 'button[type="submit"]').textContent).toBe("Save");
	});

	it.each([true, false])("sets every save control's disabled state for read-only access (%s)", (accessIsReadOnly) => {
		const doc = addLinkDoc({ accessIsReadOnly });

		const controls = Array.from(
			doc.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
				'[data-test-form^="save-article"] input[name="url"], [data-test-form^="save-article"] button[type="submit"], #add-link button[type="submit"]',
			),
		);
		expect(controls).toHaveLength(5);
		expect(controls.map((control) => control.disabled)).toEqual(Array(5).fill(accessIsReadOnly));
	});

	it("offers a file dropzone in the dialog as its own form after the link form, posting to the tracked import", () => {
		const doc = addLinkDoc();

		const dialog = element(doc, "#add-link");
		const dropzone = element(dialog, '[data-test-form="upload-file"]');
		expect(dropzone.tagName.toLowerCase()).toBe("form");
		expect(dropzone.closest("#add-link-form")).toBeNull();
		const forms = Array.from(dialog.querySelectorAll<Element>("form"));
		expect(forms.indexOf(dropzone)).toBe(forms.indexOf(element(dialog, "#add-link-form")) + 1);
		const action = new URL(dropzone.getAttribute("action") ?? "", "https://readplace.test");
		expect(action.pathname).toBe("/import");
		expect(action.searchParams.get("utm_source")).toBe("queue-add-article");
		expect(element(dropzone, 'input[type="file"]').id).toBe("add-article-file");
	});

	it.each([true, false])("sets the dropzone's file field disabled state for read-only access (%s)", (accessIsReadOnly) => {
		const doc = addLinkDoc({ accessIsReadOnly });

		expect(element<HTMLInputElement>(doc, '[data-test-form="upload-file"] input[type="file"]').disabled).toBe(accessIsReadOnly);
	});

	it("points the no-popover disclosure at the book upload page", () => {
		const doc = addLinkDoc();

		const link = element(doc, "details[data-test-add-link-fallback] [data-test-add-link-fallback-upload]");
		const url = new URL(link.getAttribute("href") ?? "", "https://readplace.test");
		expect(url.pathname).toBe("/upload");
		expect(url.searchParams.get("utm_source")).toBe("queue-add-article");
		expect(url.searchParams.get("utm_content")).toBe("upload");
	});

	it("leaves the dropzone out of a pending link's form", () => {
		const doc = parse(addLink({ saveUrl: "https://example.com/a" }).pendingHtml);

		expect(doc.querySelector('[data-test-form="upload-file"]')).toBeNull();
	});

	it("renders one visible prefilled form, outside any dialog, for a pending link", () => {
		const rendered = addLink({ saveUrl: "https://example.com/article?x=1&y=2" });
		const doc = parse(rendered.pendingHtml);

		expect(rendered.controlHtml).toBe("");
		expect(rendered.dialogHtml).toBe("");
		const pending = element(doc, "#add-link");
		expect(pending.hasAttribute("popover")).toBe(false);
		expect(element(pending, "#add-link-title").textContent).toBe("Add article");
		const forms = doc.querySelectorAll("form");
		expect(forms).toHaveLength(1);
		const form = forms[0];
		expect(form.hasAttribute("data-auto-submit")).toBe(true);
		expect(element<HTMLInputElement>(form, 'input[name="url"]').value).toBe("https://example.com/article?x=1&y=2");
		const save = element<HTMLButtonElement>(pending, 'button[type="submit"]');
		expect(save.disabled).toBe(false);
		expect(save.id).toBe("add-link-save");
		expect(save.getAttribute("form")).toBe(form.id);
		expect(form.contains(save)).toBe(false);
		expect(element(save, ".readlist__save-btn-label").textContent).toBe("Save");
		expect(element(save, ".readlist__save-btn-saving").textContent).toBe("Saving…");
		expect(element(pending, '[data-test-action="add-link-cancel"]').getAttribute("type")).toBe("button");
		expect(doc.querySelector('[role="radiogroup"]')).toBeNull();
		expect(doc.querySelector("[autofocus]")).toBeNull();
	});
});

describe("Add link form", () => {
	it("leaves its buttons to the surface around it, so a refused save keeps them", () => {
		expect(formDoc().querySelector("form button")).toBeNull();
	});

	it("keeps the entered link and describes it by an empty error line until the save is refused", () => {
		const doc = formDoc({ value: "https://example.com/a" });

		const input = element<HTMLInputElement>(doc, 'input[name="url"]');
		expect(input.value).toBe("https://example.com/a");
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		const error = element(doc, `#${input.getAttribute("aria-describedby")}`);
		expect(error.textContent).toBe("");
		expect(error.getAttribute("role")).toBe("alert");
		expect(error.hasAttribute("data-test-save-error")).toBe(false);
	});

	it("puts a refused link's reason under the field it marks invalid, keeping what was typed", () => {
		const doc = formDoc({ value: "not a link", error: { message: "Enter a valid article link.", code: "malformed_url" } });

		const input = element<HTMLInputElement>(doc, 'input[name="url"]');
		expect(input.value).toBe("not a link");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(input.hasAttribute("autofocus")).toBe(true);
		const error = element(doc, "[data-test-save-error]");
		expect(input.getAttribute("aria-describedby")).toBe(error.id);
		expect(error.textContent).toBe("Enter a valid article link.");
		expect(error.classList.contains("form-field__error")).toBe(true);
		expect(error.getAttribute("data-test-saveable-url-code")).toBe("malformed_url");
	});

	it("shows a failed save without a validation code", () => {
		const doc = formDoc({ error: { message: "Couldn't save this article. Try again." } });

		const error = element(doc, "[data-test-save-error]");
		expect(error.textContent).toBe("Couldn't save this article. Try again.");
		expect(error.hasAttribute("data-test-saveable-url-code")).toBe(false);
	});
});

describe("Save feedback", () => {
	function feedbackDoc(input: Parameters<typeof renderReadlistSaveFeedback>[0]): Document {
		return parse(renderReadlistSaveFeedback(input));
	}

	it.each([undefined, [], [{ message: "" }]])("shows nothing when there is nothing to report (%j)", (errors) => {
		expect(renderReadlistSaveFeedback({ errors }).trim()).toBe("");
	});

	it("reports a save refused after a redirect as an error alert carrying its code", () => {
		const doc = feedbackDoc({ errors: [{ message: "Enter a valid article link." }], saveErrorCode: "malformed_url" });

		const wrapper = element(doc, "[data-test-save-error]");
		expect(wrapper.getAttribute("data-test-saveable-url-code")).toBe("malformed_url");
		const alert = element(wrapper, '[data-test-alert="save-link-error"]');
		expect(alert.getAttribute("role")).toBe("alert");
		expect(element(alert, "[data-test-alert-title]").textContent).toBe("Couldn't save the link");
		expect(element(alert, "[data-test-alert-message]").textContent).toBe("Enter a valid article link.");
	});

	it("reports a failed save without a validation code", () => {
		const doc = feedbackDoc({ errors: [{ message: "Couldn't save this article. Try again." }] });

		expect(element(doc, "[data-test-save-error]").hasAttribute("data-test-saveable-url-code")).toBe(false);
	});

	it("reports an import's result as a status", () => {
		const doc = feedbackDoc({ importFlash: "3 of 3 links imported." });

		const flash = element(doc, "[data-test-import-flash]");
		const alert = element(flash, '[data-test-alert="import-result"]');
		expect(alert.getAttribute("role")).toBe("status");
		expect(flash.textContent).toBe("3 of 3 links imported.");
	});

	it("shows escaped skipped links in the shared error alert, with the remaining count", () => {
		const doc = feedbackDoc({
			importFlash: "42 of 50 links imported. 8 couldn't be imported.",
			importSkipped: {
				entries: [{ url: '<script>alert("link")</script>', reasonLabel: "Invalid link" }],
				andMore: 3,
			},
		});

		const wrapper = element(doc, "[data-test-import-skipped]");
		const alert = element(wrapper, '[data-test-alert="import-skipped"]');
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(wrapper.hasAttribute("role")).toBe(false);
		expect(element(alert, "[data-test-alert-title]").textContent).toBe("Some links couldn't be imported");
		const row = element(alert, "[data-test-import-skipped-row]");
		expect(element(row, "[data-test-import-skipped-reason]").textContent).toBe("Invalid link");
		expect(row.firstElementChild?.textContent).toBe("Invalid link —");
		expect(element(row, "[data-test-import-skipped-url]").textContent).toBe('<script>alert("link")</script>');
		expect(row.querySelectorAll("script")).toHaveLength(0);
		expect(element(alert, "[data-test-import-skipped-more]").textContent).toBe("And 3 more.");
		expect(wrapper.previousElementSibling?.hasAttribute("data-test-import-flash")).toBe(true);
	});

	it("omits the remaining-count line when every skipped link fits", () => {
		const doc = feedbackDoc({ importSkipped: { entries: [{ url: "chrome://extensions/", reasonLabel: "Unsupported link" }], andMore: 0 } });

		const alert = element(doc, '[data-test-alert="import-skipped"]');
		expect(alert.querySelectorAll("[data-test-import-skipped-row]")).toHaveLength(1);
		expect(alert.querySelectorAll("[data-test-import-skipped-more]")).toHaveLength(0);
	});

	it("shows nothing for an import whose skipped list is empty", () => {
		expect(renderReadlistSaveFeedback({ importSkipped: { entries: [], andMore: 0 } }).trim()).toBe("");
	});
});

describe("Add link by upgrade standing", () => {
	it("open: a reader who can write keeps the dialog control even when an upgrade is on offer", () => {
		const doc = addLinkDoc({ offer: OFFER });

		expect(element(doc, '[data-test-action="add-link"]').getAttribute("popovertarget")).toBe("add-link");
		expect(element<HTMLInputElement>(doc, '[data-test-form="save-article"] input[name="url"]').disabled).toBe(false);
		expect(doc.querySelectorAll("[data-test-needs-upgrade]")).toHaveLength(0);
	});

	it("needs-upgrade: one lock takes the control slot and the dialog is not rendered", () => {
		const rendered = addLink({ accessIsReadOnly: true, offer: OFFER });
		const doc = parse(`${rendered.controlHtml}${rendered.dialogHtml}`);

		const slot = element(doc, "[data-test-add-link]");
		const trigger = element(slot, '[data-test-action="upgrade-open"]');
		expect(trigger.getAttribute("data-test-needs-upgrade")).toBe("add-link");
		expect(trigger.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(trigger.classList.contains("btn--neutral")).toBe(true);
		expect(element(slot, ".needs-upgrade__label").textContent).toBe("Add article");
		expect(element(slot, '[data-test-action="upgrade-fallback"]').getAttribute("href")).toBe(
			"/account/plans?utm_source=queue-add-link&utm_medium=internal&utm_content=upgrade-add-link",
		);
		expect(slot.querySelectorAll('[data-test-action="add-link"]')).toHaveLength(0);
		expect(rendered.dialogHtml).toBe("");
	});

	it("withheld: a read-only reader with nothing on offer keeps today's disabled control", () => {
		const doc = addLinkDoc({ accessIsReadOnly: true, offer: undefined });

		expect(element(doc, '[data-test-action="add-link"]').getAttribute("popovertarget")).toBe("add-link");
		expect(element<HTMLInputElement>(doc, '[data-test-form="save-article"] input[name="url"]').disabled).toBe(true);
		expect(element<HTMLInputElement>(doc, "#add-link-fallback-url").disabled).toBe(true);
		expect(doc.querySelectorAll("[data-test-needs-upgrade]")).toHaveLength(0);
	});

	it("keeps the pending save's disabled form for a read-only reader an upgrade is offered to", () => {
		const rendered = addLink({ accessIsReadOnly: true, offer: OFFER, saveUrl: "https://example.com/a" });
		const doc = parse(rendered.pendingHtml);

		expect(element<HTMLInputElement>(doc, 'input[name="url"]').disabled).toBe(true);
		expect(rendered.controlHtml).toBe("");
	});
});
