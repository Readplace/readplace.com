import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { resolveWizardStep } from "./wizard";
import { WIZARD_STYLES, type WizardRender, renderWizard } from "./wizard.component";
import { defineWizardStep, type WizardHeading, type WizardSteps } from "./wizard.types";

interface SignupViewModel {
	handle: string;
	bio: string;
}

const step = defineWizardStep<SignupViewModel>();

const HANDLE_STEP = step({
	id: "handle",
	title: "What should we call you?",
	description: "The name other readers see.",
	viewModel: ["handle"],
	template: ({ values, field }) =>
		`<input name="handle" id="${field.idPrefix}-handle" aria-describedby="${field.errorId}"${field.invalid ? ' aria-invalid="true"' : ""} value="${values.handle ?? ""}" data-test-field="handle">`,
});

const BIO_STEP = step({
	id: "bio",
	title: "Say something about yourself",
	description: "A sentence or two.",
	viewModel: ["bio"],
	template: ({ values, field }) =>
		`<input name="bio" id="${field.idPrefix}-bio" aria-describedby="${field.errorId}" value="${values.bio ?? ""}" data-test-field="bio">`,
});

const STEPS: WizardSteps<SignupViewModel> = [HANDLE_STEP, BIO_STEP];

const FAILURE = "Couldn't save your profile.";

function renderSurfaces(input: {
	values: Partial<SignupViewModel>;
	error?: string;
	heading?: WizardHeading;
}): WizardRender {
	return renderWizard({
		id: "signup-wizard",
		key: "signup",
		steps: STEPS,
		values: input.values,
		action: "/signup/wizard?utm_source=signup",
		cancelHref: "/signup?utm_source=signup",
		submitLabel: "Save",
		heading: input.heading ?? { kind: "step" },
		failureMessage: FAILURE,
		error: input.error,
	});
}

function render(values: Partial<SignupViewModel>, error?: string, heading?: WizardHeading): Document {
	const wizard = renderSurfaces({ values, error, heading });
	return new JSDOM(`<main>${wizard.popoverHtml}${wizard.inlineHtml}</main>`).window.document;
}

function testActions(row: Element | null): (string | null)[] {
	assert(row, "every surface must lay its choices on a row");
	return Array.from(row.querySelectorAll("[data-test-action]"), (control) =>
		control.getAttribute("data-test-action"),
	);
}

function form(doc: Document, surface: "popover" | "inline"): Element {
	const element = doc.querySelector(`[data-test-wizard-surface="${surface}"]`);
	assert(element, `the ${surface} surface must render its form`);
	return element;
}

describe("resolveWizardStep", () => {
	it("asks for the earliest slice the reader has not answered yet", () => {
		assert.equal(resolveWizardStep({ steps: STEPS, values: {} }).id, "handle");
	});

	it("moves on once an earlier step's slice is filled in", () => {
		assert.equal(resolveWizardStep({ steps: STEPS, values: { handle: "ada" } }).id, "bio");
	});

	it("reopens at the first step when every slice is already answered", () => {
		assert.equal(
			resolveWizardStep({ steps: STEPS, values: { handle: "ada", bio: "Engineer." } }).id,
			"handle",
		);
	});
});

describe("renderWizard", () => {
	it("renders the resolved step into both surfaces at once", () => {
		const doc = render({ handle: "ada", bio: "Engineer." });

		for (const surface of ["popover", "inline"] as const) {
			expect(form(doc, surface).getAttribute("data-test-wizard-step")).toBe("handle");
			expect(form(doc, surface).getAttribute("data-test-wizard")).toBe("signup");
		}
	});

	it("gives each surface its own field ids so the two copies never collide", () => {
		const doc = render({ handle: "ada" });
		const ids = Array.from(doc.querySelectorAll('[data-test-field="bio"]')).map((field) =>
			field.getAttribute("id"),
		);

		expect(ids).toEqual(["signup-wizard-popover-bio", "signup-wizard-inline-bio"]);
	});

	it("points each field at the error paragraph of its own surface", () => {
		const doc = render({});
		const field = doc.querySelector('[data-test-wizard-surface="inline"] [data-test-field="handle"]');
		assert(field, "the inline surface must render the step's field");
		const errorId = field.getAttribute("aria-describedby");
		assert(errorId, "the field must name the paragraph that carries its error");

		expect(doc.getElementById(errorId)?.getAttribute("data-test-wizard-error")).toBe("");
	});

	it("keeps the error paragraph in the DOM and empty while nothing is wrong", () => {
		const doc = render({});
		const error = doc.querySelector('[data-test-wizard-surface="popover"] [data-test-wizard-error]');
		assert(error, "the error paragraph must render whether or not there is an error");

		expect(error.className).toBe("form-field__error");
		expect(error.textContent).toBe("");
		expect(
			Array.from(doc.querySelectorAll('[data-test-field="handle"]'), (field) => field.getAttribute("aria-invalid")),
		).toEqual([null, null]);
	});

	it("shows the same message on both surfaces when the answer was refused", () => {
		const doc = render({}, "Say something first.");
		const errors = Array.from(doc.querySelectorAll("[data-test-wizard-error]"));

		expect(errors.map((error) => error.textContent)).toEqual([
			"Say something first.",
			"Say something first.",
		]);
	});

	it("marks the field invalid on both surfaces when the answer was refused", () => {
		const doc = render({}, "Say something first.");
		const fields = Array.from(doc.querySelectorAll('[data-test-field="handle"]'));

		expect(fields.map((field) => field.getAttribute("aria-invalid"))).toEqual(["true", "true"]);
		expect(fields.map((field) => field.getAttribute("aria-describedby"))).toEqual([
			"signup-wizard-popover-error",
			"signup-wizard-inline-error",
		]);
	});

	it("sends both surfaces to the same action, so a no-JS submit lands where the popover would", () => {
		const doc = render({});

		expect(form(doc, "popover").getAttribute("action")).toBe("/signup/wizard?utm_source=signup");
		expect(form(doc, "inline").getAttribute("action")).toBe("/signup/wizard?utm_source=signup");
	});

	it("dismisses the popover in place but navigates away from the inline fallback", () => {
		const doc = render({});
		const popoverCancel = doc.querySelector('[data-test-action="signup-cancel"]');
		const inlineCancel = doc.querySelector('[data-test-action="signup-cancel-fallback"]');
		assert(popoverCancel, "the popover must offer a cancel that closes it");
		assert(inlineCancel, "the inline fallback must offer a cancel that navigates back");

		expect(popoverCancel.getAttribute("popovertarget")).toBe("signup-wizard");
		expect(popoverCancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(inlineCancel.getAttribute("href")).toBe("/signup?utm_source=signup");
	});

	it("names the save control apart on each surface", () => {
		const doc = render({});
		const saves = Array.from(doc.querySelectorAll('[data-test-action^="signup-save"]'));

		expect(saves.map((save) => save.getAttribute("data-test-action"))).toEqual([
			"signup-save",
			"signup-save-fallback",
		]);
		expect(saves.map((save) => save.textContent)).toEqual(["Save", "Save"]);
	});

	it("titles the popover and the inline fallback with the step being asked", () => {
		const doc = render({ handle: "ada" });
		const panel = doc.querySelector('[data-test-confirm-popover="signup"]');
		const inline = doc.querySelector('[data-test-wizard-inline="signup"]');
		assert(panel, "the popover surface must render the shared confirmation frame");
		assert(inline, "the inline surface must render its own titled section");

		expect(panel.querySelector(".confirm-popover__title")?.textContent).toBe(BIO_STEP.title);
		expect(panel.querySelectorAll(".confirm-popover__subheading")).toHaveLength(0);
		expect(inline.querySelector(".wizard__title")?.textContent).toBe(BIO_STEP.title);
		expect(inline.querySelectorAll(".wizard__subheading")).toHaveLength(0);
		expect(inline.querySelector(".wizard__description")?.textContent).toBe(BIO_STEP.description);
	});

	it("titles the dialog with the task and asks the step's question under it, on both surfaces", () => {
		const doc = render({ handle: "ada" }, undefined, { kind: "task", title: "Edit your profile" });
		const panel = doc.querySelector('[data-test-confirm-popover="signup"]');
		const inline = doc.querySelector('[data-test-wizard-inline="signup"]');
		assert(panel, "the popover surface must render the shared confirmation frame");
		assert(inline, "the inline surface must render its own titled section");

		expect(panel.querySelector(".confirm-popover__title")?.textContent).toBe("Edit your profile");
		expect(Array.from(panel.querySelectorAll(".confirm-popover__subheading"), (h) => h.textContent)).toEqual([
			BIO_STEP.title,
		]);
		expect(panel.querySelector(".confirm-popover__body")?.textContent).toBe(BIO_STEP.description);
		expect(inline.querySelector(".wizard__title")?.textContent).toBe("Edit your profile");
		expect(Array.from(inline.querySelectorAll(".wizard__subheading"), (h) => h.textContent)).toEqual([
			BIO_STEP.title,
		]);
		expect(inline.querySelector(".wizard__description")?.textContent).toBe(BIO_STEP.description);
	});

	it("offers Cancel before Save on both surfaces, each in the neutral look", () => {
		const doc = render({});

		expect(testActions(form(doc, "popover").querySelector(".confirm-popover__buttons"))).toEqual([
			"signup-cancel",
			"signup-save",
		]);
		expect(testActions(form(doc, "inline").querySelector(".wizard__buttons"))).toEqual([
			"signup-cancel-fallback",
			"signup-save-fallback",
		]);
		expect(
			Array.from(doc.querySelectorAll('[data-test-action^="signup-cancel"]'), (cancel) => cancel.className),
		).toEqual(["btn btn--neutral", "btn btn--neutral"]);
	});

	it("lays each surface's choices on its own row, last in the form", () => {
		const doc = render({});

		expect(form(doc, "popover").lastElementChild?.className).toBe("confirm-popover__buttons");
		expect(form(doc, "inline").lastElementChild?.className).toBe("wizard__buttons");
		expect(WIZARD_STYLES).toContain(".wizard__buttons {");
	});

	it("refuses in place only from the popover, and posts the inline fallback as a plain form", () => {
		const doc = render({});
		const popover = form(doc, "popover");
		const inline = form(doc, "inline");
		const ATTRIBUTES = [
			"method",
			"action",
			"hx-post",
			"hx-target",
			"hx-swap",
			"hx-sync",
			"hx-boost",
			"hx-select",
			"data-readlist-name-form",
			"data-readlist-name-failure",
		];
		const attributesOf = (element: Element) =>
			Object.fromEntries(
				ATTRIBUTES.filter((name) => element.hasAttribute(name)).map((name) => [name, element.getAttribute(name)]),
			);

		expect(attributesOf(popover)).toEqual({
			method: "POST",
			action: "/signup/wizard?utm_source=signup",
			"hx-post": "/signup/wizard?utm_source=signup",
			"hx-target": "this",
			"hx-swap": "outerHTML show:none",
			"hx-sync": "closest [popover]:drop",
			"data-readlist-name-form": "",
			"data-readlist-name-failure": FAILURE,
		});
		expect(popover.querySelectorAll("[data-test-wizard-error][data-readlist-name-error]")).toHaveLength(1);
		expect(attributesOf(inline)).toEqual({
			method: "POST",
			action: "/signup/wizard?utm_source=signup",
			"hx-boost": "false",
		});
	});

	it("hands back the popover form on its own, for a refusal to swap into the open dialog", () => {
		const wizard = renderSurfaces({ values: {}, error: "Say something first." });
		const body = new JSDOM(wizard.popoverFormHtml).window.document.body;

		expect(wizard.popoverHtml).toContain(wizard.popoverFormHtml);
		expect(Array.from(body.children, (child) => child.getAttribute("data-test-wizard-surface"))).toEqual([
			"popover",
		]);
		expect(body.querySelector("[data-test-wizard-error]")?.textContent).toBe("Say something first.");
	});

	it("swaps Save's label for the in-flight dots while its request runs", () => {
		const doc = render({});
		const save = doc.querySelector('[data-test-action="signup-save"]');
		assert(save, "the popover must offer its save control");

		expect(Array.from(save.children, (child) => child.className)).toEqual([
			"wizard__save-label",
			"wizard__save-loader in-flight-dots",
		]);
		expect(WIZARD_STYLES).toContain(".htmx-request .wizard__save-label {");
		expect(WIZARD_STYLES).toContain(".htmx-request .wizard__save-loader {");
	});
});
