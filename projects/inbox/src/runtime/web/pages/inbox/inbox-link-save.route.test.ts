import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<save@x>";
const EMAIL_PROVENANCE = { kind: "email", senderEmail: "news@example.com" };
const WORK = ReadlistSlugSchema.parse("work");

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "crawled",
		title: "A post",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		anchorText: undefined,
		...overrides,
	};
}

function email(userId: UserId): InboxEmailEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<save@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/save",
		bodyS3Key: "content/save/content.html",
		linkCounts: undefined,
	};
}

/** Seeds the owning email as well as the link, so a test can follow the save's
 * redirect and assert on the page it lands on rather than only its Location. */
async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	overrides: Partial<InboxEmailLinkEntry> = {},
): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(email(user.userId));
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(user.userId, overrides));
	return user.userId;
}

type LinksMeta = Parameters<
	ReturnType<typeof createDefaultTestAppFixture>["inboxEmail"]["inboxEmailLinkStore"]["putLinksMeta"]
>[0]["meta"];

/** A skipped row exists only once extraction finished, so its email carries
 * link counts and its links carry meta, as they do in production. */
async function seedSkipped(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	input: { link?: Partial<InboxEmailLinkEntry>; meta?: LinksMeta } = {},
): Promise<UserId> {
	const userId = await seed(fixture, {
		status: "skipped",
		skipReason: "llm-ad",
		title: undefined,
		...input.link,
	});
	await fixture.inboxEmail.inboxEmailStore.setEmailLinkCounts({
		userId,
		receivedAtMessageId: SK,
		linkCounts: { kept: 2, skipped: 3, truncated: false },
	});
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId,
		receivedAtMessageId: SK,
		meta: input.meta ?? { truncated: false, extractionFailed: false },
	});
	return userId;
}

const savePath = `/inbox/${encodeURIComponent(SK)}/links/0000/save`;
const cardPath = `/inbox/${encodeURIComponent(SK)}/links/0000/card`;

describe("Inbox link save route", () => {
	it("publishes a submit for the stored link, reports nothing, and redirects back to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
		// A kept card carries no misclassification verdict, so its save logs no
		// classifier-audit line — only a skipped row's save reports one.
		expect(errors).toHaveLength(0);
	});

	it("counts the reader's save as engagement activity that activates a recent assignment", async () => {
		const now = new Date("2026-06-24T10:00:00.000Z");
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => now;
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		const assignment = {
			campaignId: "hn-starter-v1",
			arm: "comparison" as const,
			assignedAt: "2026-06-23T10:00:00.000Z",
			tier: "trial" as const,
			accountCohort: "new" as const,
		};
		await fixture.engagementStarter.assignStarter({
			userId,
			revision: 0,
			assignment,
			pack: {
				campaignId: assignment.campaignId,
				picks: [],
				readlist: WORK,
				readlistLabel: "Hacker News picks",
				selectedAt: assignment.assignedAt,
				emailStatus: "pending",
			},
		});

		await agent.post(savePath);

		expect(await fixture.engagementStarter.findEngagement(userId)).toEqual({
			assignment,
			activityRevision: 2,
			lastActivityAt: now.toISOString(),
			activatedAt: now.toISOString(),
		});
	});

	const onboardingDown = new Error("onboarding write failed");
	it.each<{ failure: unknown; logged: Error | undefined; description: string }>([
		{ failure: onboardingDown, logged: onboardingDown, description: "an error" },
		{ failure: "onboarding write failed", logged: undefined, description: "a non-error value" },
	])(
		"keeps the save when recording its activity throws $description",
		async ({ failure, logged }) => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.engagementStarter.recordEngagementActivity = async () => {
				throw failure;
			};
			const errors: { message: string; error: Error | undefined }[] = [];
			fixture.shared.logError = (message, error) => {
				errors.push({ message, error });
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = await seed(fixture);

			const response = await agent.post(savePath);

			expect(response.status).toBe(303);
			expect(harness.submittedLinks.map((submitted) => submitted.userId)).toEqual([userId]);
			expect(errors).toEqual([{ message: "Failed to record engagement activity", error: logged }]);
		},
	);

	it("confirms the save on the followed redirect as a dismissable status toast", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath);
		const confirmation = await agent.get(response.headers.location);

		const doc = new JSDOM(confirmation.text).window.document;
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "the followed redirect must confirm the save");
		// Present tense: the route only publishes SubmitLinkCommand — the queue row
		// is written by a downstream subscriber.
		expect(doc.querySelector("[data-test-toast-message]")?.textContent?.trim()).toBe(
			"Adding to All…",
		);
		// data-dismiss is what the global toast script reads to fade the toast out,
		// so a stale flag can't pin it on screen.
		expect(toast.getAttribute("role")).toBeNull();
		expect(toast.getAttribute("aria-live")).toBeNull();
		expect(toast.getAttribute("data-dismiss")).toBe("6000");
	});

	it("renders no toast on a plain view of the same page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const plain = await agent.get(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&utm_source=inbox-mail-tabs&utm_medium=internal&utm_content=articles`,
		);

		expect(new JSDOM(plain.text).window.document.querySelector("[data-test-toast]")).toBe(null);
	});

	it("carries the readlist filter back so the reader returns to the same filtered list", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).type("form").send({ readlist: "work", show: "rest" });

		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&readlist=work&show=rest&saved=1`,
		);
	});

	it("carries the expanded page size back so the saved card keeps its place in the list", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).type("form").send({ shown: "40" });

		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40&saved=1`,
		);
	});

	it("submits the stored URL even when the preview resolved elsewhere — the save pipeline owns redirects", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { resolvedUrl: "https://cdn.example.com/final" });

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
	});

	it("strips the newsletter's utm tags from a crawled link before submitting it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			url: "https://example.com/post?id=7&utm_source=nl&utm_medium=email",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post?id=7", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
	});

	it("submits a pending wrapper byte-exact, so a signed query survives the redirect chain", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			status: "pending",
			title: undefined,
			url: "https://link.mail.example.com/ss/c/token?utm_source=nl",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://link.mail.example.com/ss/c/token?utm_source=nl", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	it("returns 404 for an unknown link and publishes nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("saves a misclassified skipped link byte-exact, reports it, and redirects to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seedSkipped(fixture, {
			link: { url: "https://example.com/story?utm_source=nl&sig=abc" },
		});

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://example.com/story?utm_source=nl&sig=abc", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG },
		]);
		// Saving a skipped row IS the report now that the report button is gone: the
		// save emits the same classifier-audit line the button used to, so a
		// misclassification still reaches the operator's error widget.
		expect(errors).toHaveLength(1);
		assert(errors[0].startsWith("[inbox-link-feedback] "));
		const feedback = JSON.parse(errors[0].slice("[inbox-link-feedback] ".length));
		expect(feedback).toMatchObject({
			verdict: "should-be-included",
			receivedAtMessageId: SK,
			ordinal: "0000",
			url: "https://example.com/story?utm_source=nl&sig=abc",
			status: "skipped",
			skipReason: "llm-ad",
		});
		expect(feedback).not.toHaveProperty("userId");
	});

	it("saves a skipped social link as a manual save and confirms it on the followed redirect", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seedSkipped(fixture, {
			link: { skipReason: "social-host", url: "https://x.com/someone/status/1" },
		});

		const response = await agent.post(savePath);
		const confirmation = await agent.get(response.headers.location);

		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://x.com/someone/status/1", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG },
		]);
		expect(
			new JSDOM(confirmation.text).window.document
				.querySelector("[data-test-toast-message]")
				?.textContent?.trim(),
		).toBe("Adding to All…");
	});

	it("returns 404 for a skipped link the save pipeline would reject, publishing nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, {
			status: "skipped",
			skipReason: "list-unsubscribe",
			title: undefined,
			url: "https://localhost/private",
		});

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a malformed ordinal and publishes nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/save`,
		);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a link the save pipeline would reject", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { url: "https://localhost/private" });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a private item identity, publishing nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef" });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

});

describe("Inbox link save route answering htmx in place", () => {
	let settlingFixture: ReturnType<typeof createDefaultTestAppFixture> | undefined;
	const useSettlingApp = useTestServer({
		publishSubmitLink: async ({ userId, url }) => {
			assert(settlingFixture, "the settling fixture must be built before the save");
			await settlingFixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({
				userId: UserIdSchema.parse(userId),
				url,
			});
		},
	});

	function articleCard(html: string): Element {
		const doc = new JSDOM(html).window.document;
		const cards = doc.querySelectorAll("[data-test-inbox-article-card]");
		assert.equal(cards.length, 1, "the response carries exactly one card");
		const card = cards[0];
		assert(card, "the card must render");
		return card;
	}

	function cardSaveButton(card: Element): Element {
		const button = card.querySelector('[data-test-card-action="save"]');
		assert(button, "the card must keep offering its save button");
		return button;
	}

	it("keeps the boosted whole-page redirect for a page still running the old markup", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedSkipped(fixture);

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.set("HX-Boosted", "true");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
	});

	it("answers a non-boosted htmx save of a kept card with the card itself, saving and polling for the settle", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(200);
		const card = articleCard(response.text);
		expect(card.getAttribute("id")).toBe("inbox-card-0000");
		expect(card.getAttribute("hx-get")).toBe(`${cardPath}?poll=1&shown=20&awaitSave=1`);
		expect(card.getAttribute("hx-trigger")).toBe("every 3s");
		expect(card.getAttribute("hx-target")).toBe("this");
		expect(card.getAttribute("hx-swap")).toBe("outerHTML");
		const button = cardSaveButton(card);
		expect(button.getAttribute("data-test-save-state")).toBe("saving");
		expect(button.textContent?.trim()).toBe("Saving…");
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
		expect(errors).toHaveLength(0);
	});

	it("posts the card's save form to itself while its report button keeps boosting the page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).set("HX-Request", "true");

		const card = articleCard(response.text);
		const saveForm = cardSaveButton(card).closest("form");
		assert(saveForm, "the save button must stay inside its form");
		expect(saveForm.getAttribute("method")).toBe("POST");
		expect(saveForm.getAttribute("action")).toBe(`${savePath}?utm_source=inbox-link-card&utm_medium=internal&utm_content=save-link`);
		expect(saveForm.getAttribute("hx-post")).toBe(`${savePath}?utm_source=inbox-link-card&utm_medium=internal&utm_content=save-link`);
		expect(saveForm.getAttribute("hx-target")).toBe("#inbox-card-0000");
		expect(saveForm.getAttribute("hx-swap")).toBe("outerHTML");
		expect(saveForm.getAttribute("hx-disabled-elt")).toBe("find button");
		const report = card.querySelector('[data-test-card-action="feedback-exclude"]');
		assert(report, "the card must keep offering its report button");
		const reportForm = report.closest("form");
		assert(reportForm, "the report button must stay inside its form");
		expect(reportForm.getAttribute("hx-boost")).toBe("true");
		expect(reportForm.getAttribute("hx-target")).toBe("main");
		expect(reportForm.getAttribute("hx-select")).toBe("main");
		expect(reportForm.getAttribute("hx-swap")).toBe("outerHTML show:none");
	});

	it("keeps the boosted whole-page redirect for a kept card still running the old markup", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.set("HX-Boosted", "true");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
	});

	it("carries the expanded page size into the card's own settle poll", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.type("form")
			.send({ shown: "40" });

		expect(articleCard(response.text).getAttribute("hx-get")).toBe(
			`${cardPath}?poll=1&shown=40&awaitSave=1`,
		);
	});

	it("reads the kept card's save state after publishing, so a settle that already landed skips Saving… entirely", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		settlingFixture = fixture;
		const harness = useSettlingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(200);
		const card = articleCard(response.text);
		expect(card.hasAttribute("hx-get")).toBe(false);
		expect(cardSaveButton(card).getAttribute("data-test-save-state")).toBe("saved");
		const live = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-live-status]",
		);
		assert(live, "a save that settled inside the request must announce itself");
		expect(live.textContent).toBe("Saved to All: https://example.com/post");
	});

	it("retracts a kept card's recorded failure before retrying, so the retry reads as in flight rather than dead", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaveFailed({
			userId,
			url: "https://example.com/post",
		});

		const response = await agent.post(savePath).set("HX-Request", "true");

		const card = articleCard(response.text);
		expect(card.getAttribute("hx-get")).toBe(`${cardPath}?poll=1&shown=20&awaitSave=1`);
		expect(cardSaveButton(card).getAttribute("data-test-save-state")).toBe("saving");
		expect(
			await fixture.inboxEmail.inboxSavedLinkStore.findSavedLinks({
				userId,
				urls: ["https://example.com/post"],
			}),
		).toEqual(new Map());
	});

	it("retracts a recorded failure on the plain form post too", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaveFailed({
			userId,
			url: "https://example.com/post",
		});

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(
			await fixture.inboxEmail.inboxSavedLinkStore.findSavedLinks({
				userId,
				urls: ["https://example.com/post"],
			}),
		).toEqual(new Map());
	});

});

describe("Inbox link save route moving a skipped link to Extracted Articles", () => {
	const WORK_ONLY: LinksMeta = {
		truncated: false,
		extractionFailed: false,
		selectedReadlists: [{ readlist: WORK, label: "Work" }],
		eligibleArticleCount: 2,
	};

	async function savedLink(fixture: ReturnType<typeof createDefaultTestAppFixture>, userId: UserId) {
		const { links, meta } = await fixture.inboxEmail.inboxEmailLinkStore.listLinksByEmail({
			userId,
			receivedAtMessageId: SK,
		});
		const email = await fixture.inboxEmail.inboxEmailStore.getEmail({ userId, receivedAtMessageId: SK });
		return { status: links[0]?.status, meta, linkCounts: email?.linkCounts };
	}

	it("answers an in-place save with the moved row, the new tab counts and an announcement", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedSkipped(fixture);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const row = doc.querySelector('[data-test-inbox-excluded-link="0000"]');
		assert(row, "the response replaces the skipped row");
		expect(row.getAttribute("id")).toBe("inbox-skipped-0000");
		expect(row.hasAttribute("data-test-inbox-excluded-moved")).toBe(true);
		expect(row.querySelector("[data-test-inbox-excluded-moved-notice]")?.textContent?.trim()).toBe(
			"Saved as article. View in Articles",
		);
		expect(row.querySelector("[data-test-inbox-excluded-moved-link]")?.getAttribute("href")).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles`,
		);
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (1)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="excluded"]')?.textContent).toBe("Skipped (0)");
		expect(doc.querySelector("[data-test-inbox-live-status]")?.textContent).toBe(
			"Saved as article: https://example.com/post",
		);
	});

	it("moves the link to pending, starts its preview crawl and moves one count to kept", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seedSkipped(fixture);

		await agent.post(savePath);

		const after = await savedLink(fixture, userId);
		expect(after.status).toBe("pending");
		expect(after.linkCounts).toEqual({ kept: 3, skipped: 2, truncated: false });
		expect(harness.crawlPreviews).toEqual([
			{ userId, receivedAtMessageId: SK, ordinal: "0000", url: "https://example.com/post" },
		]);
		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	it("sends the link to each readlist the email was routed to, to be judged on its own", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const home = ReadlistSlugSchema.parse("home");
		const userId = await seedSkipped(fixture, {
			link: { anchorText: "a".repeat(130) },
			meta: {
				...WORK_ONLY,
				selectedReadlists: [
					{ readlist: WORK, label: "Work" },
					{ readlist: home, label: "Home" },
				],
			},
		});

		await agent.post(savePath);

		const triaged = {
			scope: "link",
			userId,
			receivedAtMessageId: SK,
			senderEmail: "news@example.com",
			subject: "Weekly digest",
			links: [{ ordinal: "0000", url: "https://example.com/post", anchorText: "a".repeat(120) }],
		};
		expect(harness.savedLinkTriages).toEqual([
			{ ...triaged, readlist: WORK },
			{ ...triaged, readlist: home },
		]);
		expect((await savedLink(fixture, userId)).meta?.eligibleArticleCount).toBe(3);
	});

	it("judges a link with no anchor text by its URL alone", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedSkipped(fixture, { meta: WORK_ONLY });

		await agent.post(savePath);

		expect(harness.savedLinkTriages.map((triage) => triage.links)).toEqual([
			[{ ordinal: "0000", url: "https://example.com/post", anchorText: "" }],
		]);
	});

	it("counts the link for a held email's readlists without judging it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seedSkipped(fixture, { meta: { ...WORK_ONLY, savesHeld: true } });

		await agent.post(savePath);

		const after = await savedLink(fixture, userId);
		expect(after.status).toBe("pending");
		expect(after.meta?.eligibleArticleCount).toBe(3);
		expect(harness.savedLinkTriages).toEqual([]);
	});

	it("saves a link from an email routed to no readlist to All only", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seedSkipped(fixture);

		await agent.post(savePath);

		const after = await savedLink(fixture, userId);
		expect(after.status).toBe("pending");
		expect(after.meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.savedLinkTriages).toEqual([]);
	});

	it("moves nothing a second time when another save already moved the link", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const owner = await seedSkipped(fixture, { meta: WORK_ONLY });
		const linkStore = fixture.inboxEmail.inboxEmailLinkStore;
		const stale = await linkStore.getLink({
			userId: owner,
			receivedAtMessageId: SK,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		await linkStore.rescueSkippedLink({
			userId: owner,
			receivedAtMessageId: SK,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		linkStore.getLink = async () => stale;

		await agent.post(savePath);

		expect(harness.crawlPreviews).toEqual([]);
		expect(harness.savedLinkTriages).toEqual([]);
		expect((await savedLink(fixture, owner)).linkCounts).toEqual({ kept: 2, skipped: 3, truncated: false });
	});
});

describe("Inbox link save route under the save gates", () => {
	function hxHeaderNames(headers: Record<string, unknown>): string[] {
		return Object.keys(headers)
			.filter((name) => name.startsWith("hx-"))
			.sort();
	}

	it("hands a locked reader's in-place save the headers that put the locked page back in <main>", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * 86_400_000);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(403);
		expect(new JSDOM(response.text).window.document.querySelector("h1")?.textContent).toBe(
			"Your account is locked",
		);
		expect(hxHeaderNames(response.headers)).toEqual(["hx-reselect", "hx-reswap", "hx-retarget"]);
		expect(response.headers["hx-retarget"]).toBe("main");
		expect(response.headers["hx-reselect"]).toBe("main");
		expect(response.headers["hx-reswap"]).toBe("outerHTML show:none");
		expect(harness.submittedLinks).toEqual([]);
	});

	it("leaves a boosted locked save exactly as it was, since boost already targets <main>", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * 86_400_000);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.set("HX-Boosted", "true");

		expect(response.status).toBe(403);
		expect(hxHeaderNames(response.headers)).toEqual([]);
	});
});

describe("Inbox link save route with a relayed publisher", () => {
	// The e2e harness stands in for the deployed round trip — publish, accept,
	// LinkQueued, read model — so the Saved chip can appear against an in-memory
	// stack. This pins that seam from the same route a reader would use.
	const relayed: Array<{ userId: string; url: string }> = [];
	const useRelayingApp = useTestServer({
		publishSubmitLink: async (input) => {
			relayed.push(input);
		},
	});

	it("shows a saved skipped link as an article on the tab the save redirects to", async () => {
		relayed.length = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useRelayingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedSkipped(fixture);

		const response = await agent.post(savePath);
		const doc = new JSDOM((await agent.get(response.headers.location)).text).window.document;

		expect(response.headers.location).toContain("tab=articles");
		const card = doc.querySelector('[data-test-inbox-article-card="0000"]');
		assert(card, "the saved link is listed among the extracted articles");
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (1)",
		);
	});
	it("relays the submitted link to the injected publisher as well as recording it", async () => {
		relayed.length = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useRelayingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(relayed).toEqual([{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post", provenance: EMAIL_PROVENANCE, saveTrigger: "manual", readlist: DEFAULT_READLIST_SLUG }]);
	});
});
