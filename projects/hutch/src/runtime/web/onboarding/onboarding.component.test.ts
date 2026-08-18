import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { OnboardingChecklist } from "./onboarding.component";
import type { InstallableClientOnboarding, OnboardingContext } from "./onboarding.types";

function contextWith(
	overrides: Partial<Omit<InstallableClientOnboarding, "hasInstallableClient">> = {},
): InstallableClientOnboarding {
	return {
		hasInstallableClient: true,
		installed: false,
		savedArticle: false,
		savedCount: 0,
		platform: "chrome",
		...overrides,
	};
}

/** A device with no installable client renders the escape card; its context is
 * just the discriminant — no platform/installed/savedArticle can exist to
 * disagree with the no-client state. */
const NO_CLIENT_CONTEXT: OnboardingContext = { hasInstallableClient: false };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("OnboardingChecklist", () => {
	it("renders every step incomplete and container visible when nothing is done", () => {
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

		const nextReadStep = doc.querySelector('[data-test-onboarding-step="save-enough-for-next-read"]');
		assert(nextReadStep, "save-enough-for-next-read step must be rendered");
		assert.equal(nextReadStep.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("renders the founder avatar alongside the intro text", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const avatar = doc.querySelector(".onboarding__avatar");
		assert(avatar, "founder avatar must be rendered");
		assert.equal(avatar.getAttribute("alt"), "Fayner Brack");
		assert.match(avatar.getAttribute("src") ?? "", /\/fayner-brack\.jpg$/);
	});

	it("renders install-extension, then save-first-article, then the Next Read milestone", () => {
		const doc = parse(OnboardingChecklist(contextWith()));

		const steps = doc.querySelectorAll("[data-test-onboarding-step]");
		assert.equal(steps.length, 3);
		assert.equal(steps[0].getAttribute("data-test-onboarding-step"), "install-extension");
		assert.equal(steps[1].getAttribute("data-test-onboarding-step"), "save-first-article-via-extension");
		assert.equal(steps[2].getAttribute("data-test-onboarding-step"), "save-enough-for-next-read");
	});

	it("marks install-extension complete when installed is true", () => {
		const doc = parse(OnboardingChecklist(contextWith({ installed: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("carries the hiding state class on a completed row and not on an outstanding one", () => {
		const doc = parse(OnboardingChecklist(contextWith({ installed: true })));

		const done = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(done, "install-extension step must still be rendered once complete");
		assert.equal(done.classList.contains("onboarding__step--complete"), true);

		const outstanding = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(outstanding, "save-first-article step must be rendered");
		assert.equal(outstanding.classList.contains("onboarding__step--complete"), false);
	});

	it("keeps install-extension incomplete when installed is false", () => {
		const doc = parse(OnboardingChecklist(contextWith({ installed: false, savedArticle: true })));

		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("marks save-first-article complete when savedArticle is true", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: true })));

		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
	});

	it("keeps save-first-article incomplete when savedArticle is false", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: false })));

		const step = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(step, "save-first-article step must be rendered");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
	});

	it("lets the save step's title stand alone while the install step keeps its description", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "chrome" })));

		const install = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(install, "install-extension step must be rendered");
		assert.equal(install.querySelectorAll(".onboarding__step-description").length, 1);

		const save = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(save, "save-first-article step must be rendered");
		assert.equal(save.querySelectorAll(".onboarding__step-description").length, 0);
	});

	it("keeps the share-sheet walkthrough on the iPhone save step", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "iphone" })));

		const save = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"]');
		assert(save, "save-first-article step must be rendered");
		const description = save.querySelector(".onboarding__step-description");
		assert(description, "the iPhone save step must keep its description");
		assert.match(description.textContent ?? "", /tap Share/);
	});

	it("shows container when only save-first-article is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: true, installed: false })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("shows container when only install-extension is complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: false, installed: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("shows 'Install the Chrome browser extension' for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "chrome" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "firefox" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install the Firefox browser extension");
	});

	it("shows 'Install the Readplace iPhone app' for iPhone users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "iphone" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install the Readplace iPhone app");
	});

	it("shows 'Install a browser extension' for unrecognised platforms", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "other" })));
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Install a browser extension");
	});

	it("shows an 'Install' action linking to /install?client=chrome for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "chrome" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Install");
		assert.equal(action.getAttribute("href"), "/install?client=chrome");
	});

	it("shows an 'Install' action linking to /install?client=firefox for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "firefox" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Install");
		assert.equal(action.getAttribute("href"), "/install?client=firefox");
	});

	it("shows an 'Install' action linking to /install?client=iphone for iPhone users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "iphone" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Install");
		assert.equal(action.getAttribute("href"), "/install?client=iphone");
	});

	it("shows a 'Choose browser' action linking to /install for unrecognised platforms", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "other" })));
		const action = doc.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]');
		assert(action, "action link must be rendered");
		assert.equal(action.textContent, "Choose browser");
		assert.equal(action.getAttribute("href"), "/install");
	});

	it("shows 'Save your first article using the browser extension' for Chrome users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "chrome" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using the browser extension");
	});

	it("shows 'Save your first article using the browser extension' for Firefox users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "firefox" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using the browser extension");
	});

	it("shows 'Save your first article using the iPhone app' for iPhone users", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "iphone" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using the iPhone app");
	});

	it("shows 'Save your first article using a browser extension' for unrecognised platforms", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "other" })));
		const title = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__step-title');
		assert(title);
		assert.equal(title.textContent, "Save your first article using a browser extension");
	});

	it("does not render actions on save-first-article for platforms with their own client", () => {
		for (const platform of ["chrome", "firefox", "iphone"] as const) {
			const doc = parse(OnboardingChecklist(contextWith({ platform })));
			const actions = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] .onboarding__actions');
			assert.equal(actions, null, `${platform} save step must render no action`);
		}
	});

	it("renders a 'Choose browser' action on save-first-article for unrecognised platforms", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "other" })));
		const action = doc.querySelector('[data-test-onboarding-step="save-first-article-via-extension"] [data-test-onboarding-action]');
		assert(action, "fallback action must be rendered when no platform-specific client exists");
		assert.equal(action.textContent, "Choose browser");
		assert.equal(action.getAttribute("href"), "/install");
	});

	describe("Next Read milestone step", () => {
		const stepOf = (doc: Document) =>
			doc.querySelector('[data-test-onboarding-step="save-enough-for-next-read"]');

		it("stays incomplete one save short of the minimum", () => {
			const doc = parse(
				OnboardingChecklist(contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES - 1 })),
			);

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
		});

		it("completes at exactly the minimum", () => {
			const doc = parse(
				OnboardingChecklist(contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES })),
			);

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
		});

		it("counts the saves so far in the description while short of the minimum", () => {
			const doc = parse(OnboardingChecklist(contextWith({ savedCount: 12 })));

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.match(
				step.querySelector(".onboarding__step-description")?.textContent ?? "",
				new RegExp(`saved 12 of ${NEXT_READ_MINIMUM_SAVES}`),
			);
		});

		it("stops counting and points at the reader once the minimum is reached", () => {
			const doc = parse(
				OnboardingChecklist(
					contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES, installed: true }),
				),
			);

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.match(
				step.querySelector(".onboarding__step-description")?.textContent ?? "",
				/only shows when something you've saved relates/,
			);
		});

		it("names the minimum in the title", () => {
			const doc = parse(OnboardingChecklist(contextWith()));

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.equal(
				step.querySelector(".onboarding__step-title")?.textContent,
				`Save ${NEXT_READ_MINIMUM_SAVES} articles so Next Read can start`,
			);
		});

		it("reads the same on every platform, unlike the device-scoped steps", () => {
			const titles = (["chrome", "firefox", "iphone", "other"] as const).map((platform) => {
				const doc = parse(OnboardingChecklist(contextWith({ platform })));
				const step = stepOf(doc);
				assert(step, `Next Read step must be rendered for ${platform}`);
				return step.querySelector(".onboarding__step-title")?.textContent;
			});

			assert.equal(new Set(titles).size, 1);
		});

		it("offers no action of its own — saving is the action", () => {
			const doc = parse(OnboardingChecklist(contextWith()));

			const step = stepOf(doc);
			assert(step, "Next Read step must be rendered");
			assert.equal(step.querySelectorAll("[data-test-onboarding-action]").length, 0);
		});

		it("holds back the success card while it is the only step outstanding", () => {
			const doc = parse(
				OnboardingChecklist(contextWith({ installed: true, savedArticle: true, savedCount: 3 })),
			);

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--visible"));
			assert.equal(doc.querySelectorAll("[data-test-onboarding-dismiss]").length, 0);
		});
	});

	it("shows success message with avatar when both steps are complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: true, installed: true, savedCount: NEXT_READ_MINIMUM_SAVES })));

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

	it("keeps the full welcome visible for a first-time completion", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: true, installed: true, savedCount: NEXT_READ_MINIMUM_SAVES })));

		const message = doc.querySelector(".onboarding__success-message");
		assert(message, "success message must be rendered");
		assert.equal(message.classList.contains("onboarding__success-message--hidden"), false);
		assert.match(message.textContent ?? "", /one of us/);
	});

	it("greets a user who completed a previous checklist with just the title", () => {
		const doc = parse(
			OnboardingChecklist(contextWith({ savedArticle: true, installed: true, savedCount: NEXT_READ_MINIMUM_SAVES }), {
				completedBefore: true,
			}),
		);

		const title = doc.querySelector(".onboarding__success-title");
		assert(title, "success title must be rendered");
		assert.match(title.textContent ?? "", /You did it!/);

		const message = doc.querySelector(".onboarding__success-message");
		assert(message, "success message must stay rendered for its state class");
		assert.equal(message.classList.contains("onboarding__success-message--hidden"), true);
	});

	it("reaches success from the iPhone steps when both are complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ platform: "iphone", savedArticle: true, installed: true, savedCount: NEXT_READ_MINIMUM_SAVES })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered for iPhone too");
		assert.match(success.querySelector(".onboarding__success-title")?.textContent ?? "", /You did it!/);
	});

	it("does not show steps list when all complete", () => {
		const doc = parse(OnboardingChecklist(contextWith({ savedArticle: true, installed: true, savedCount: NEXT_READ_MINIMUM_SAVES })));

		const steps = doc.querySelector("[data-test-onboarding-steps]");
		assert.equal(steps, null);
	});

	it("renders the container hidden when dismissed", () => {
		const doc = parse(OnboardingChecklist(contextWith(), { dismissed: true }));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must still be rendered when dismissed");
		assert(container.classList.contains("onboarding--hidden"));
		assert(!container.classList.contains("onboarding--visible"));
	});

	describe("no installable client", () => {
		it("renders the no-client card instead of the step checklist", () => {
			const doc = parse(OnboardingChecklist(NO_CLIENT_CONTEXT));

			const noClient = doc.querySelector("[data-test-onboarding-no-client]");
			assert(noClient, "no-client card must be rendered");

			const steps = doc.querySelector("[data-test-onboarding-steps]");
			assert.equal(steps, null, "the step checklist must not render on a no-client device");

			const heading = noClient.querySelector(".onboarding__title");
			assert(heading);
			assert.match(heading.textContent ?? "", /Fayner Brack/);
		});

		it("keeps the container visible by default", () => {
			const doc = parse(OnboardingChecklist(NO_CLIENT_CONTEXT));

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--visible"));
			assert(!container.classList.contains("onboarding--hidden"));
		});

		it("offers a 'See install options' action linking to /install", () => {
			const doc = parse(OnboardingChecklist(NO_CLIENT_CONTEXT));

			const action = doc.querySelector("[data-test-onboarding-no-client] [data-test-onboarding-action]");
			assert(action, "install-options link must be rendered");
			assert.equal(action.textContent, "See install options");
			assert.equal(action.getAttribute("href"), "/install");
		});

		it("offers a Dismiss button that POSTs to the dismiss route", () => {
			const doc = parse(OnboardingChecklist(NO_CLIENT_CONTEXT));

			const dismiss = doc.querySelector("[data-test-onboarding-dismiss]");
			assert(dismiss, "Dismiss button must be rendered");
			assert.equal(dismiss.textContent, "Dismiss");

			const form = dismiss.closest("form");
			assert(form, "Dismiss button must live inside a form");
			assert.equal(form.getAttribute("method"), "POST");
			assert.equal(form.getAttribute("action"), "/queue/dismiss-onboarding");
		});

		it("renders the no-client card hidden when dismissed", () => {
			const doc = parse(OnboardingChecklist(NO_CLIENT_CONTEXT, { dismissed: true }));

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must still be rendered when dismissed");
			assert(container.classList.contains("onboarding--hidden"));
			assert(!container.classList.contains("onboarding--visible"));

			const noClient = doc.querySelector("[data-test-onboarding-no-client]");
			assert(noClient, "no-client card markup must still be present, just hidden via the state class");
		});
	});
});
