import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { OnboardingChecklist } from "./onboarding.component";
import type { InstallableClientOnboarding, OnboardingContext } from "./onboarding.types";

const DEFAULT_OPTIONS = {
	dismissed: false,
	completedBefore: false,
	completionUnearned: false,
	returnQuery: "",
};

function contextWith(
	overrides: Partial<Omit<InstallableClientOnboarding, "hasInstallableClient">> = {},
): InstallableClientOnboarding {
	return {
		hasInstallableClient: true,
		installed: false,
		savedArticle: false,
		savedCount: 0,
		platform: "chrome",
		inboxArticleQueued: false,
		emailStepMarkedDone: false,
		...overrides,
	};
}

const COMPLETE = {
	installed: true,
	savedArticle: true,
	inboxArticleQueued: true,
	savedCount: NEXT_READ_MINIMUM_SAVES,
} as const;

function checklist(
	ctx: OnboardingContext,
	options: Partial<typeof DEFAULT_OPTIONS> = {},
): string {
	return OnboardingChecklist(ctx, { ...DEFAULT_OPTIONS, ...options });
}

/** A device with no installable client renders the escape card; its context is
 * just the discriminant — no platform/installed/savedArticle can exist to
 * disagree with the no-client state. */
const NO_CLIENT_CONTEXT: OnboardingContext = { hasInstallableClient: false };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function stepIds(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-onboarding-step]")).map(
		(el) => el.getAttribute("data-test-onboarding-step") ?? "",
	);
}

function stepOf(doc: Document, id: string): Element {
	const step = doc.querySelector(`[data-test-onboarding-step="${id}"]`);
	assert(step, `${id} step must be rendered`);
	return step;
}

function actionKeys(step: Element): string[] {
	return Array.from(step.querySelectorAll("[data-test-onboarding-action]")).map(
		(el) => el.getAttribute("data-test-onboarding-action") ?? "",
	);
}

function actionForm(step: Element, key: string): Element {
	const button = step.querySelector(`[data-test-onboarding-action="${key}"]`);
	assert(button, `action ${key} must be rendered`);
	const form = button.closest("form");
	assert(form, `action ${key} must live inside a form`);
	return form;
}

const PLATFORMS = ["chrome", "firefox", "iphone", "other"] as const;

describe("OnboardingChecklist", () => {
	it("renders every step incomplete and container visible when nothing is done", () => {
		const doc = parse(checklist(contextWith()));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
		assert(!container.classList.contains("onboarding--hidden"));

		for (const id of [
			"install-extension",
			"save-first-article-via-extension",
			"receive-articles-by-email",
			"save-enough-for-next-read",
		]) {
			assert.equal(stepOf(doc, id).getAttribute("data-test-onboarding-complete"), "false");
		}
	});

	it("renders the founder avatar alongside the intro text", () => {
		const doc = parse(checklist(contextWith()));

		const avatar = doc.querySelector(".onboarding__avatar");
		assert(avatar, "founder avatar must be rendered");
		assert.equal(avatar.getAttribute("alt"), "Fayner Brack");
		assert.match(avatar.getAttribute("src") ?? "", /\/fayner-brack\.jpg$/);
	});

	it("renders install, save, the email step, then the Next Read milestone in order", () => {
		const doc = parse(checklist(contextWith()));

		assert.deepEqual(stepIds(doc), [
			"install-extension",
			"save-first-article-via-extension",
			"receive-articles-by-email",
			"save-enough-for-next-read",
		]);
	});

	it("marks install-extension complete when installed is true", () => {
		const doc = parse(checklist(contextWith({ installed: true })));

		const step = stepOf(doc, "install-extension");
		assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
		assert.equal(step.classList.contains("onboarding__step--complete"), true);
	});

	it("carries the hiding state class on a completed row and not on an outstanding one", () => {
		const doc = parse(checklist(contextWith({ installed: true })));

		assert.equal(
			stepOf(doc, "install-extension").classList.contains("onboarding__step--complete"),
			true,
		);
		assert.equal(
			stepOf(doc, "save-first-article-via-extension").classList.contains(
				"onboarding__step--complete",
			),
			false,
		);
	});

	it("keeps install-extension incomplete when installed is false", () => {
		const doc = parse(checklist(contextWith({ installed: false, savedArticle: true })));

		assert.equal(
			stepOf(doc, "install-extension").getAttribute("data-test-onboarding-complete"),
			"false",
		);
	});

	it("marks save-first-article complete when savedArticle is true", () => {
		const doc = parse(checklist(contextWith({ savedArticle: true })));

		assert.equal(
			stepOf(doc, "save-first-article-via-extension").getAttribute(
				"data-test-onboarding-complete",
			),
			"true",
		);
	});

	it("lets the save step's title stand alone while the install step keeps its description", () => {
		const doc = parse(checklist(contextWith({ platform: "chrome" })));

		assert.equal(
			stepOf(doc, "install-extension").querySelectorAll(".onboarding__step-description").length,
			1,
		);
		assert.equal(
			stepOf(doc, "save-first-article-via-extension").querySelectorAll(
				".onboarding__step-description",
			).length,
			0,
		);
	});

	it("keeps the share-sheet walkthrough on the iPhone save step", () => {
		const doc = parse(checklist(contextWith({ platform: "iphone" })));

		const description = stepOf(doc, "save-first-article-via-extension").querySelector(
			".onboarding__step-description",
		);
		assert(description, "the iPhone save step must keep its description");
		assert.match(description.textContent ?? "", /tap Share/);
	});

	it("shows the container while any step is outstanding", () => {
		const doc = parse(checklist(contextWith({ savedArticle: true, installed: true })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("titles the install step per platform", () => {
		const titleByPlatform = {
			chrome: "Install the Chrome browser extension",
			firefox: "Install the Firefox browser extension",
			iphone: "Install the Readplace iPhone app",
			other: "Install a browser extension",
		} satisfies Record<(typeof PLATFORMS)[number], string>;
		for (const platform of PLATFORMS) {
			const doc = parse(checklist(contextWith({ platform })));
			assert.equal(
				stepOf(doc, "install-extension").querySelector(".onboarding__step-title")?.textContent,
				titleByPlatform[platform],
			);
		}
	});

	it("renders the install action as a GET form carrying the client as a hidden input", () => {
		const byPlatform = { chrome: "chrome", firefox: "firefox", iphone: "iphone" } as const;
		for (const client of Object.values(byPlatform)) {
			const doc = parse(checklist(contextWith({ platform: client })));
			const step = stepOf(doc, "install-extension");
			assert.deepEqual(actionKeys(step), ["install"]);
			const form = actionForm(step, "install");
			assert.equal(form.getAttribute("method"), "GET");
			assert.equal(form.getAttribute("action"), "/install");
			const input = form.querySelector('input[name="client"]');
			assert(input, "the platform must ride as a hidden input, not in the action query");
			assert.equal(input.getAttribute("value"), client);
		}
	});

	it("renders a query-less Choose browser action carrying only its tracking inputs for unrecognised platforms", () => {
		const doc = parse(checklist(contextWith({ platform: "other" })));
		const step = stepOf(doc, "install-extension");
		assert.deepEqual(actionKeys(step), ["choose-browser"]);
		const form = actionForm(step, "choose-browser");
		assert.equal(form.getAttribute("action"), "/install");
		assert.deepEqual(
			Array.from(form.querySelectorAll("input"), (input) => [
				input.getAttribute("name"),
				input.getAttribute("value"),
			]),
			[
				["utm_source", "onboarding"],
				["utm_medium", "internal"],
				["utm_content", "choose-browser"],
			],
		);
	});

	it("titles the save step per platform", () => {
		const titleByPlatform = {
			chrome: "Save your first article using the browser extension",
			firefox: "Save your first article using the browser extension",
			iphone: "Save your first article using the iPhone app",
			other: "Save your first article using a browser extension",
		} satisfies Record<(typeof PLATFORMS)[number], string>;
		for (const platform of PLATFORMS) {
			const doc = parse(checklist(contextWith({ platform })));
			assert.equal(
				stepOf(doc, "save-first-article-via-extension").querySelector(".onboarding__step-title")
					?.textContent,
				titleByPlatform[platform],
			);
		}
	});

	it("renders no action on save-first-article for platforms with their own client", () => {
		for (const platform of ["chrome", "firefox", "iphone"] as const) {
			const doc = parse(checklist(contextWith({ platform })));
			assert.deepEqual(actionKeys(stepOf(doc, "save-first-article-via-extension")), []);
		}
	});

	it("renders a Choose browser action on save-first-article for unrecognised platforms", () => {
		const doc = parse(checklist(contextWith({ platform: "other" })));
		const step = stepOf(doc, "save-first-article-via-extension");
		assert.deepEqual(actionKeys(step), ["choose-browser"]);
		assert.equal(actionForm(step, "choose-browser").getAttribute("action"), "/install");
	});

	describe("Get articles from email step", () => {
		const emailStep = (doc: Document) => stepOf(doc, "receive-articles-by-email");

		it("stays incomplete until a link from an inbox email is queued", () => {
			const doc = parse(checklist(contextWith()));
			assert.equal(emailStep(doc).getAttribute("data-test-onboarding-complete"), "false");
		});

		it("completes once a link from an inbox email has been queued", () => {
			const doc = parse(checklist(contextWith({ inboxArticleQueued: true })));
			const step = emailStep(doc);
			assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
			assert.equal(step.classList.contains("onboarding__step--complete"), true);
		});

		it("reads the same title and description on every platform", () => {
			const titles = (["chrome", "firefox", "iphone", "other"] as const).map((platform) => {
				const doc = parse(checklist(contextWith({ platform })));
				const step = emailStep(doc);
				assert.match(
					step.querySelector(".onboarding__step-description")?.textContent ?? "",
					/own email address/,
				);
				return step.querySelector(".onboarding__step-title")?.textContent;
			});
			assert.deepEqual([...new Set(titles)], ["Get articles from email"]);
		});

		it("offers the inbox addresses page as its GET CTA, followed by the POST mark-done", () => {
			const doc = parse(checklist(contextWith()));
			const step = emailStep(doc);
			assert.deepEqual(actionKeys(step), ["see-inbox-address", "email-mark-done"]);

			const cta = actionForm(step, "see-inbox-address");
			assert.equal(cta.getAttribute("method"), "GET");
			assert.equal(cta.getAttribute("action"), "/inbox/addresses");
			assert.deepEqual(
				Array.from(cta.querySelectorAll("input"), (input) => [
					input.getAttribute("name"),
					input.getAttribute("value"),
				]),
				[
					["utm_source", "onboarding"],
					["utm_medium", "internal"],
					["utm_content", "see-inbox-address"],
				],
			);
			assert.equal(
				step
					.querySelector('[data-test-onboarding-action="see-inbox-address"]')
					?.getAttribute("class"),
				"btn btn--primary btn--compact",
			);

			const markDone = actionForm(step, "email-mark-done");
			assert.equal(markDone.getAttribute("method"), "POST");
			assert.equal(markDone.getAttribute("action"), "/queue/onboarding/email/done?utm_source=onboarding&utm_medium=internal&utm_content=email-mark-done");
			assert.equal(
				step.querySelector('[data-test-onboarding-action="email-mark-done"]')?.getAttribute("class"),
				"onboarding__dismiss-text",
			);
		});

		it("stamps the return query onto the POST mark-done and dismiss forms, never the GET CTA", () => {
			const doc = parse(checklist(contextWith(), { returnQuery: "?tab=done" }));
			assert.equal(
				actionForm(emailStep(doc), "email-mark-done").getAttribute("action"),
				"/queue/onboarding/email/done?tab=done&utm_source=onboarding&utm_medium=internal&utm_content=email-mark-done",
			);
			assert.equal(
				actionForm(emailStep(doc), "see-inbox-address").getAttribute("action"),
				"/inbox/addresses",
			);

			const success = parse(checklist(contextWith(COMPLETE), { returnQuery: "?tab=done" }));
			const dismiss = success.querySelector("[data-test-onboarding-dismiss]");
			assert(dismiss, "success dismiss must be rendered");
			assert.equal(
				dismiss.closest("form")?.getAttribute("action"),
				"/queue/dismiss-onboarding?tab=done&utm_source=onboarding&utm_medium=internal&utm_content=dismiss-success",
			);
		});

		it("keeps the mark-done control off every other step", () => {
			const doc = parse(checklist(contextWith({ platform: "chrome" })));
			assert.deepEqual(actionKeys(stepOf(doc, "install-extension")), ["install"]);
			assert.deepEqual(actionKeys(stepOf(doc, "save-first-article-via-extension")), []);
			assert.deepEqual(actionKeys(stepOf(doc, "save-enough-for-next-read")), []);
		});

		it("completes once the reader marks it done, with no inbox article needed", () => {
			const doc = parse(checklist(contextWith({ emailStepMarkedDone: true })));

			const step = emailStep(doc);
			assert.equal(step.getAttribute("data-test-onboarding-complete"), "true");
			assert.equal(step.classList.contains("onboarding__step--complete"), true);
		});

		it("hides the card without congratulating a reader whose every step, this one included, was satisfied on arrival", () => {
			const doc = parse(
				checklist(
					contextWith({ ...COMPLETE, inboxArticleQueued: false, emailStepMarkedDone: true }),
					{ completionUnearned: true },
				),
			);

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must still be rendered");
			assert(container.classList.contains("onboarding--hidden"));
			assert(!container.classList.contains("onboarding--complete"));
		});

		it("congratulates a reader who marks the email step done as the last thing on the list", () => {
			const doc = parse(
				checklist(
					contextWith({ ...COMPLETE, inboxArticleQueued: false, emailStepMarkedDone: true }),
					{ completionUnearned: false },
				),
			);

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--complete"));
			assert(doc.querySelector("[data-test-onboarding-success]"), "success card must be rendered");
		});

		it("keeps the checklist visible after marking the email step done while others remain", () => {
			const doc = parse(checklist(contextWith({ emailStepMarkedDone: true, installed: true })));

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--visible"));
		});
	});

	describe("Next Read milestone step", () => {
		const stepOfDoc = (doc: Document) => stepOf(doc, "save-enough-for-next-read");

		it("stays incomplete one save short of the minimum", () => {
			const doc = parse(checklist(contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES - 1 })));
			assert.equal(stepOfDoc(doc).getAttribute("data-test-onboarding-complete"), "false");
		});

		it("completes at exactly the minimum", () => {
			const doc = parse(checklist(contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES })));
			assert.equal(stepOfDoc(doc).getAttribute("data-test-onboarding-complete"), "true");
		});

		it("counts the saves so far in the description while short of the minimum", () => {
			const doc = parse(checklist(contextWith({ savedCount: 12 })));
			assert.match(
				stepOfDoc(doc).querySelector(".onboarding__step-description")?.textContent ?? "",
				new RegExp(`saved 12 of ${NEXT_READ_MINIMUM_SAVES}`),
			);
		});

		it("stops counting and points at the reader once the minimum is reached", () => {
			const doc = parse(
				checklist(contextWith({ savedCount: NEXT_READ_MINIMUM_SAVES, installed: true })),
			);
			assert.match(
				stepOfDoc(doc).querySelector(".onboarding__step-description")?.textContent ?? "",
				/only shows when something you've saved relates/,
			);
		});

		it("names the minimum in the title", () => {
			const doc = parse(checklist(contextWith()));
			assert.equal(
				stepOfDoc(doc).querySelector(".onboarding__step-title")?.textContent,
				`Save ${NEXT_READ_MINIMUM_SAVES} articles so Next Read can start`,
			);
		});

		it("offers no action of its own — saving is the action", () => {
			const doc = parse(checklist(contextWith()));
			assert.deepEqual(actionKeys(stepOfDoc(doc)), []);
		});

		it("holds back the success card while it is the only step outstanding", () => {
			const doc = parse(
				checklist(
					contextWith({ installed: true, savedArticle: true, inboxArticleQueued: true, savedCount: 3 }),
				),
			);

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--visible"));
			assert.equal(doc.querySelectorAll("[data-test-onboarding-dismiss]").length, 0);
		});
	});

	it("shows success message with avatar when every step is complete", () => {
		const doc = parse(checklist(contextWith(COMPLETE)));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		assert(!container.classList.contains("onboarding--visible"));

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
		assert.match(success.querySelector(".onboarding__success-title")?.textContent ?? "", /You did it!/);
		assert.match(success.querySelector(".onboarding__success-message")?.textContent ?? "", /one of us/);
		assert(success.querySelector(".onboarding__avatar"), "founder avatar must be shown in success state");
	});

	it("keeps the full welcome visible for a first-time completion", () => {
		const doc = parse(checklist(contextWith(COMPLETE)));

		const message = doc.querySelector(".onboarding__success-message");
		assert(message, "success message must be rendered");
		assert.equal(message.classList.contains("onboarding__success-message--hidden"), false);
		assert.match(message.textContent ?? "", /one of us/);
	});

	it("greets a user who completed a previous checklist with just the title", () => {
		const doc = parse(checklist(contextWith(COMPLETE), { completedBefore: true }));

		assert.match(doc.querySelector(".onboarding__success-title")?.textContent ?? "", /You did it!/);
		const message = doc.querySelector(".onboarding__success-message");
		assert(message, "success message must stay rendered for its state class");
		assert.equal(message.classList.contains("onboarding__success-message--hidden"), true);
	});

	it("stays hidden when every step was already satisfied on arrival", () => {
		const doc = parse(
			checklist(contextWith(COMPLETE), { completedBefore: true, completionUnearned: true }),
		);

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must still be rendered");
		assert(container.classList.contains("onboarding--hidden"));
		assert(!container.classList.contains("onboarding--complete"));
	});

	it("still congratulates a reader who finished the last outstanding step", () => {
		const doc = parse(
			checklist(contextWith(COMPLETE), { completedBefore: true, completionUnearned: false }),
		);

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		assert(doc.querySelector("[data-test-onboarding-success]"));
	});

	it("keeps an unearned flag harmless while a step is still outstanding", () => {
		const doc = parse(checklist(contextWith({ installed: true }), { completionUnearned: true }));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--visible"));
	});

	it("reaches success from the iPhone steps when every step is complete", () => {
		const doc = parse(checklist(contextWith({ ...COMPLETE, platform: "iphone" })));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must be rendered");
		assert(container.classList.contains("onboarding--complete"));
		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered for iPhone too");
		assert.match(success.querySelector(".onboarding__success-title")?.textContent ?? "", /You did it!/);
	});

	it("does not show steps list when all complete", () => {
		const doc = parse(checklist(contextWith(COMPLETE)));
		assert.equal(doc.querySelector("[data-test-onboarding-steps]"), null);
	});

	it("renders the container hidden when dismissed", () => {
		const doc = parse(checklist(contextWith(), { dismissed: true }));

		const container = doc.querySelector("[data-test-onboarding]");
		assert(container, "onboarding container must still be rendered when dismissed");
		assert(container.classList.contains("onboarding--hidden"));
		assert(!container.classList.contains("onboarding--visible"));
	});

	describe("no installable client", () => {
		it("renders the no-client card instead of the step checklist", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			const noClient = doc.querySelector("[data-test-onboarding-no-client]");
			assert(noClient, "no-client card must be rendered");
			assert.equal(
				doc.querySelector("[data-test-onboarding-steps]"),
				null,
				"the step checklist must not render on a no-client device",
			);
			assert.match(noClient.querySelector(".onboarding__title")?.textContent ?? "", /Fayner Brack/);
		});

		it("keeps the container visible by default", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must be rendered");
			assert(container.classList.contains("onboarding--visible"));
			assert(!container.classList.contains("onboarding--hidden"));
		});

		it("offers a See install options action as a GET form to /install", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			const noClient = doc.querySelector("[data-test-onboarding-no-client]");
			assert(noClient, "no-client card must be rendered");
			assert.deepEqual(actionKeys(noClient), ["see-install-options"]);
			const form = actionForm(noClient, "see-install-options");
			assert.equal(form.getAttribute("method"), "GET");
			assert.equal(form.getAttribute("action"), "/install");
		});

		it("offers a Dismiss button that POSTs to the dismiss route", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			const dismiss = doc.querySelector("[data-test-onboarding-dismiss]");
			assert(dismiss, "Dismiss button must be rendered");
			assert.equal(dismiss.textContent, "Dismiss");
			const form = dismiss.closest("form");
			assert(form, "Dismiss button must live inside a form");
			assert.equal(form.getAttribute("method"), "POST");
			assert.equal(form.getAttribute("action"), "/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client");
		});

		it("stamps the return query onto the no-client dismiss form", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT, { returnQuery: "?tab=done" }));

			const dismiss = doc.querySelector("[data-test-onboarding-dismiss]");
			assert(dismiss, "Dismiss button must be rendered");
			assert.equal(
				dismiss.closest("form")?.getAttribute("action"),
				"/queue/dismiss-onboarding?tab=done&utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client",
			);
		});

		it("renders the no-client card hidden when dismissed", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT, { dismissed: true }));

			const container = doc.querySelector("[data-test-onboarding]");
			assert(container, "onboarding container must still be rendered when dismissed");
			assert(container.classList.contains("onboarding--hidden"));
			assert(!container.classList.contains("onboarding--visible"));
			assert(
				doc.querySelector("[data-test-onboarding-no-client]"),
				"no-client card markup must still be present, just hidden via the state class",
			);
		});
	});
});
