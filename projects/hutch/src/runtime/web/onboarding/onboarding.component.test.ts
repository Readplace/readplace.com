import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { OnboardingChecklist } from "./onboarding.component";
import type { OnboardingContext } from "./onboarding.types";

function contextWith(overrides: Partial<OnboardingContext> = {}): OnboardingContext {
	return {
		extensionInstalled: false,
		extensionSavedArticle: false,
		browser: "chrome",
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

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(saveStep, "save-first-article step must be rendered");
		assert.equal(saveStep.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("renders the founder avatar alongside the intro text", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const avatar = doc.querySelector(".onboarding__avatar");
		assert(avatar, "founder avatar must be rendered");
		assert.equal(avatar.getAttribute("alt"), "Fayner Brack");
		assert.match(avatar.getAttribute("src") ?? "", /\/fayner-brack\.jpg$/);
	});

	it("renders install-extension before save-first-article", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const steps = doc.querySelectorAll("[data-test-onboarding-step]");
		assert(steps.length >= 2, "at least two steps must be rendered");
		assert.equal(steps[0].getAttribute("data-test-onboarding-step"), "install-extension");
		assert.equal(steps[1].getAttribute("data-test-onboarding-step"), "save-first-article-via-extension");
	});

	it("marks install-extension complete when extensionInstalled is true", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionInstalled: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("keeps install-extension incomplete when extensionInstalled is false", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionInstalled: false, extensionSavedArticle: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("marks save-first-article complete when extensionSavedArticle is true", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: true })));

		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("keeps save-first-article incomplete when extensionSavedArticle is false", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: false })));

		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("shows container when only save-first-article is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: true, extensionInstalled: false })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("shows container when only install-extension is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: false, extensionInstalled: true })));

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

	it("shows 'Save your first article using the browser extension' for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "chrome" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using the browser extension");
	});

	it("shows 'Save your first article using the browser extension' for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "firefox" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using the browser extension");
	});

	it("shows 'Save your first article using a browser extension' for unrecognised browsers", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "other" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using a browser extension");
	});

	it("does not render actions on save-first-article for browsers with an extension", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "chrome" })));
		const actions = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__actions');
		assert.equal(actions, null);
	});

	it("renders a 'Choose browser' action on save-first-article for unrecognised browsers", () => {
		const doc = parse(OnboardingChecklist(contextWith({ browser: "other" })));
		const action = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] [data-test-onboarding-action]');
		assert(action, "fallback action must be rendered when no browser-specific extension exists");
		assert.equal(action.textContent, "Choose browser");
		assert.equal(action.getAttribute("href"), "/install");
	});

	it("shows success message with avatar when both steps are complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: true, extensionInstalled: true })));

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

	it("does not show steps list when all complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ extensionSavedArticle: true, extensionInstalled: true })));

		const steps = doc.querySelector("[data-test-onboarding-steps]");
		assert.equal(steps, null);
	});
});
