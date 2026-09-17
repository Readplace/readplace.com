import assert from "node:assert/strict";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { OnboardingDesignChecklist } from "./onboarding-design.component";
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
	return OnboardingDesignChecklist(ctx, { ...DEFAULT_OPTIONS, ...options });
}

const NO_CLIENT_CONTEXT: OnboardingContext = { hasInstallableClient: false };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function container(doc: Document): Element {
	const el = doc.querySelector("[data-test-setup-guide]");
	assert(el, "setup guide container must be rendered");
	return el;
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

function detailsOf(doc: Document, id: string): Element {
	const details = stepOf(doc, id).querySelector(".setup-guide__disclosure");
	assert(details, `${id} step must carry a disclosure`);
	return details;
}

function actionKeys(el: Element): string[] {
	return Array.from(el.querySelectorAll("[data-test-onboarding-action]")).map(
		(button) => button.getAttribute("data-test-onboarding-action") ?? "",
	);
}

function actionForm(el: Element, key: string): Element {
	const button = el.querySelector(`[data-test-onboarding-action="${key}"]`);
	assert(button, `action ${key} must be rendered`);
	const form = button.closest("form");
	assert(form, `action ${key} must live inside a form`);
	return form;
}

function assertUtmTagged(form: Element): void {
	const method = form.getAttribute("method");
	assert(method === "GET" || method === "POST", `unexpected form method ${method}`);
	if (method === "GET") {
		const names = Array.from(form.querySelectorAll('input[type="hidden"]'), (input) =>
			input.getAttribute("name"),
		);
		assert(names.includes("utm_source"), "GET form must carry utm_source as a hidden input");
		assert(names.includes("utm_medium"), "GET form must carry utm_medium as a hidden input");
		assert(names.includes("utm_content"), "GET form must carry utm_content as a hidden input");
		return;
	}
	const action = form.getAttribute("action") ?? "";
	const query = new URLSearchParams(action.split("?")[1] ?? "");
	assert(query.has("utm_source"), "POST form action must carry utm_source in its query");
	assert(query.has("utm_medium"), "POST form action must carry utm_medium in its query");
	assert(query.has("utm_content"), "POST form action must carry utm_content in its query");
}

describe("OnboardingDesignChecklist", () => {
	it("carries both the legacy and the design test attributes on the root", () => {
		const doc = parse(checklist(contextWith()));
		const root = container(doc);
		assert(root.hasAttribute("data-test-onboarding"));
		assert(root.hasAttribute("data-test-setup-guide"));
	});

	it("renders every step, install current and open, at 0% on first run", () => {
		const doc = parse(checklist(contextWith()));

		assert(container(doc).classList.contains("setup-guide--visible"));
		assert(!container(doc).classList.contains("setup-guide--hidden"));

		assert.deepEqual(stepIds(doc), [
			"install-extension",
			"save-first-article-via-extension",
			"receive-articles-by-email",
			"save-enough-for-next-read",
		]);

		const progress = doc.querySelector(".setup-guide__progress-label");
		assert(progress, "progress label must be rendered");
		assert.equal(progress.getAttribute("data-test-onboarding-progress"), "0");
		assert.match(progress.textContent ?? "", /^0% complete$/);

		const install = stepOf(doc, "install-extension");
		assert.equal(install.getAttribute("data-test-onboarding-complete"), "false");
		assert.equal(install.getAttribute("data-test-onboarding-current"), "true");
		assert(detailsOf(doc, "install-extension").hasAttribute("open"));

		for (const id of [
			"save-first-article-via-extension",
			"receive-articles-by-email",
			"save-enough-for-next-read",
		]) {
			const step = stepOf(doc, id);
			assert.equal(step.getAttribute("data-test-onboarding-complete"), "false");
			assert.equal(step.getAttribute("data-test-onboarding-current"), "false");
			assert(!detailsOf(doc, id).hasAttribute("open"));
		}
	});

	it("moves to 25% complete and opens the save step once installed", () => {
		const doc = parse(checklist(contextWith({ installed: true })));

		const progress = doc.querySelector(".setup-guide__progress-label");
		assert(progress, "progress label must be rendered");
		assert.equal(progress.getAttribute("data-test-onboarding-progress"), "25");

		const install = stepOf(doc, "install-extension");
		assert.equal(install.getAttribute("data-test-onboarding-complete"), "true");
		assert.equal(install.getAttribute("data-test-onboarding-current"), "false");
		assert(!detailsOf(doc, "install-extension").hasAttribute("open"));

		const save = stepOf(doc, "save-first-article-via-extension");
		assert.equal(save.getAttribute("data-test-onboarding-current"), "true");
		assert(detailsOf(doc, "save-first-article-via-extension").hasAttribute("open"));
	});

	it("reaches 50% once the first article is saved, moving the ask to the email step", () => {
		const doc = parse(checklist(contextWith({ installed: true, savedArticle: true })));

		const progress = doc.querySelector(".setup-guide__progress-label");
		assert(progress, "progress label must be rendered");
		assert.equal(progress.getAttribute("data-test-onboarding-progress"), "50");
		assert.equal(
			stepOf(doc, "receive-articles-by-email").getAttribute("data-test-onboarding-current"),
			"true",
		);
	});

	it("reaches 75% once the email step is auto-ticked, with the Next Read chip on the current step", () => {
		const doc = parse(
			checklist(
				contextWith({
					installed: true,
					savedArticle: true,
					emailStepMarkedDone: true,
					savedCount: 4,
				}),
			),
		);

		const progress = doc.querySelector(".setup-guide__progress-label");
		assert(progress, "progress label must be rendered");
		assert.equal(progress.getAttribute("data-test-onboarding-progress"), "75");

		const nextRead = stepOf(doc, "save-enough-for-next-read");
		assert.equal(nextRead.getAttribute("data-test-onboarding-current"), "true");
		assert(detailsOf(doc, "save-enough-for-next-read").hasAttribute("open"));

		const chip = nextRead.querySelector("[data-test-onboarding-chip]");
		assert(chip, "the Next Read step must carry a chip once current");
		assert.equal(chip.textContent, `Saved 4 of ${NEXT_READ_MINIMUM_SAVES}`);

		for (const id of [
			"install-extension",
			"save-first-article-via-extension",
			"receive-articles-by-email",
		]) {
			assert.equal(stepOf(doc, id).querySelector("[data-test-onboarding-chip]"), null);
		}
	});

	it("shows the success card at 100% complete and drops the step list", () => {
		const doc = parse(checklist(contextWith(COMPLETE)));

		assert(container(doc).classList.contains("setup-guide--complete"));
		assert(!container(doc).classList.contains("setup-guide--visible"));
		assert.equal(doc.querySelector("[data-test-onboarding-steps]"), null);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success card must be rendered");
		assert.match(
			success.querySelector(".setup-guide__success-title")?.textContent ?? "",
			/You did it!/,
		);
		assert(
			success.querySelector(".setup-guide__success-title svg"),
			"the check-circle icon must be drawn via the icon helper",
		);
		assert.match(
			success.querySelector(".setup-guide__success-message")?.textContent ?? "",
			/one of us/,
		);
	});

	it("hides the welcome message for a reader who completed a previous checklist", () => {
		const doc = parse(checklist(contextWith(COMPLETE), { completedBefore: true }));

		const message = doc.querySelector(".setup-guide__success-message");
		assert(message, "success message must stay rendered for its state class");
		assert(message.classList.contains("setup-guide__success-message--hidden"));
	});

	it("keeps the full welcome visible for a first-time completion", () => {
		const doc = parse(checklist(contextWith(COMPLETE)));

		const message = doc.querySelector(".setup-guide__success-message");
		assert(message, "success message must be rendered");
		assert.equal(message.classList.contains("setup-guide__success-message--hidden"), false);
	});

	it("hides the card when dismissed", () => {
		const doc = parse(checklist(contextWith(), { dismissed: true }));

		assert(container(doc).classList.contains("setup-guide--hidden"));
		assert(!container(doc).classList.contains("setup-guide--visible"));
	});

	it("hides the card without congratulating a reader whose completion was unearned", () => {
		const doc = parse(checklist(contextWith(COMPLETE), { completionUnearned: true }));

		assert(container(doc).classList.contains("setup-guide--hidden"));
		assert(!container(doc).classList.contains("setup-guide--complete"));
	});

	it("keeps an unearned flag harmless while a step is still outstanding", () => {
		const doc = parse(checklist(contextWith({ installed: true }), { completionUnearned: true }));

		assert(container(doc).classList.contains("setup-guide--visible"));
	});

	it("still congratulates a reader who finished the last outstanding step", () => {
		const doc = parse(
			checklist(contextWith(COMPLETE), { completedBefore: true, completionUnearned: false }),
		);

		assert(container(doc).classList.contains("setup-guide--complete"));
		assert(doc.querySelector("[data-test-onboarding-success]"));
	});

	describe("no installable client", () => {
		it("renders the no-client card instead of the step checklist", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			const noClient = doc.querySelector("[data-test-onboarding-no-client]");
			assert(noClient, "no-client card must be rendered");
			assert.equal(doc.querySelector("[data-test-onboarding-steps]"), null);
			assert.match(
				noClient.querySelector(".setup-guide__title")?.textContent ?? "",
				/doesn't have an app for this device yet/,
			);
			assert.match(
				noClient.querySelector(".setup-guide__lede")?.textContent ?? "",
				/doesn't have an app for this device yet/,
			);

			assert.deepEqual(actionKeys(noClient), ["see-install-options"]);
			const form = actionForm(noClient, "see-install-options");
			assert.equal(form.getAttribute("method"), "GET");
			assert.equal(form.getAttribute("action"), "/install");

			const dismiss = doc.querySelector("[data-test-onboarding-dismiss]");
			assert(dismiss, "Dismiss control must be rendered");
			const dismissForm = dismiss.closest("form");
			assert(dismissForm, "Dismiss control must live inside a form");
			assert.equal(dismissForm.getAttribute("method"), "POST");
		});

		it("keeps the container visible by default", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT));

			assert(container(doc).classList.contains("setup-guide--visible"));
			assert(!container(doc).classList.contains("setup-guide--hidden"));
		});

		it("renders the no-client card hidden when dismissed", () => {
			const doc = parse(checklist(NO_CLIENT_CONTEXT, { dismissed: true }));

			assert(container(doc).classList.contains("setup-guide--hidden"));
			assert(!container(doc).classList.contains("setup-guide--visible"));
			assert(doc.querySelector("[data-test-onboarding-no-client]"));
		});
	});

	it("tags every action form with utm_source/utm_medium/utm_content, hidden inputs for GET and the action query for POST", () => {
		const docs = [
			parse(checklist(contextWith())),
			parse(
				checklist(
					contextWith({
						installed: true,
						savedArticle: true,
						emailStepMarkedDone: true,
						savedCount: 4,
					}),
				),
			),
			parse(checklist(contextWith(COMPLETE))),
			parse(checklist(NO_CLIENT_CONTEXT)),
		];
		const forms = docs.flatMap((doc) => Array.from(doc.querySelectorAll("form")));
		assert(forms.length > 0, "expected forms to be rendered across every state");
		for (const form of forms) assertUtmTagged(form);
	});

	it("stamps the return query onto the POST mark-done and dismiss forms, never the GET CTA", () => {
		const doc = parse(
			checklist(contextWith({ installed: true, savedArticle: true }), {
				returnQuery: "?tab=done",
			}),
		);
		const emailStep = stepOf(doc, "receive-articles-by-email");
		assert.equal(
			actionForm(emailStep, "email-mark-done").getAttribute("action"),
			"/queue/onboarding/email/done?tab=done&utm_source=onboarding&utm_medium=internal&utm_content=email-mark-done",
		);
		assert.equal(
			actionForm(emailStep, "see-inbox-address").getAttribute("action"),
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
});
