import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { OnboardingChecklist } from "./onboarding.component";
import type { OnboardingContext } from "./onboarding.types";

function contextWith(overrides: Partial<OnboardingContext> = {}): OnboardingContext {
	return {
		savedViaExtension: false,
		extensionInstalled: false,
		browser: "chrome",
		isMobile: false,
		...overrides,
	};
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("OnboardingChecklist", () => {
	it("renders both steps incomplete and container visible when nothing is done", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
		assert(!container.classList.contains("onboarding--hidden"));

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep, "install-extension step must be rendered");
		assert.equal(installStep.getAttribute("data-test-onboarding-complete"), "false");

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save-via-extension step must be rendered");
		assert.equal(saveStep.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("renders the founder avatar alongside the intro text", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const avatar = doc.querySelector(".onboarding__avatar");
		assert(avatar, "founder avatar must be rendered");
		assert.equal(avatar.getAttribute("alt"), "Fayner Brack");
		assert.match(avatar.getAttribute("src") ?? "", /\/fayner-brack\.jpg$/);
	});

	it("renders install-extension before save-via-extension", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const steps = doc.querySelectorAll("[data-test-onboarding-step]");
		assert(steps.length >= 2, "at least two steps must be rendered");
		assert.equal(steps[0].getAttribute("data-test-onboarding-step"), "install-extension");
		assert.equal(steps[1].getAttribute("data-test-onboarding-step"), "save-via-extension");
	});

	it("uses the new save-via-extension title", () => {
		const doc = parse(OnboardingChecklist(contextWith()));
		const title = doc.querySelector('[data-test-onboarding-step="save-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article with the extension");
	});

	it("marks install-extension complete when extensionInstalled is true", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionInstalled: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("keeps install-extension incomplete when extensionInstalled is false", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionInstalled: false, savedViaExtension: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("shows container when only save-via-extension is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedViaExtension: true, extensionInstalled: false })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("shows container when only install-extension is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedViaExtension: false, extensionInstalled: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("shows 'Install the Chrome browser extension' for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "chrome" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "firefox" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install the Firefox browser extension");
	});

	it("shows 'Install a browser extension' for unrecognised browsers", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "other" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install a browser extension");
	});

	it("shows an 'Install' action linking to /install?browser=chrome for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "chrome" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Install");
		assert.equal(action.getAttribute("href"), "/install?browser=chrome");
	});

	it("shows an 'Install' action linking to /install?browser=firefox for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "firefox" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Install");
		assert.equal(action.getAttribute("href"), "/install?browser=firefox");
	});

	it("shows a 'Choose browser' action linking to /install for unrecognised browsers", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "other" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Choose browser");
		assert.equal(action.getAttribute("href"), "/install");
	});

	it("does not render actions on save-via-extension step", () => {
		const doc = parse(OnboardingChecklist(contextWith()));
		const actions = doc.querySelector('[data-test-onboarding-step="save-via-extension"] .onboarding__actions');
		assert.equal(actions, null);
	});

	it("shows success message with avatar when both steps are complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedViaExtension: true, extensionInstalled: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		assert(!container.classList.contains("onboarding--visible"));

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");

		const title = success.querySelector(".onboarding__success-title");
		assert(title);
		assert.match(title.textContent ?? "", /You did it!/);

		const message = success.querySelector(".onboarding__success-message");
		assert(message);
		assert.match(message.textContent ?? "", /one of us/);

		const avatar = success.querySelector(".onboarding__avatar");
		assert(avatar, "founder avatar must be shown in success state");
	});

	it("hides install-extension step on mobile and keeps the panel visible while save is incomplete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ isMobile: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert.equal(installStep, null, "install-extension must be omitted on mobile");

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-via-extension"]');
		assert(saveStep, "save step must still render on mobile");
		assert.equal(saveStep.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("renders the success state on mobile when the save step is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ isMobile: true, savedViaExtension: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered on mobile when save is complete");
	});

	it("does not show steps list when all complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedViaExtension: true, extensionInstalled: true })));

		const steps = doc.querySelector("[data-test-onboarding-steps]");
		assert.equal(steps, null);
	});
});
