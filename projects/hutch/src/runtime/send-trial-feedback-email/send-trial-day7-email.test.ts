import assert from "node:assert/strict";
import { MinutesSchema, type SaveProvenance, type SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { FindArticlesByUser } from "@packages/provider-contracts/article-store";
import type { UserContact } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initQueueDigestUnsubscribeToken } from "../domain/email/queue-digest-unsubscribe-token";
import { initEmitLifecycleEmailSent, type LifecycleEmailSentEvent } from "../observability/lifecycle-email-events";
import { initSendTrialFeedbackEmailHandler } from "./send-trial-feedback-email-handler";

const USER_ID = UserIdSchema.parse("8".repeat(32));
const APP_ORIGIN = "https://readplace.com";
const REGISTERED_AT = new Date("2026-11-06T00:00:00.000Z");
const WINDOW_END = new Date("2026-11-13T00:00:00.000Z");
const TRIAL_ENDS_AT = "2026-11-20T00:00:00.000Z";
const FIRED_AT = new Date("2026-11-13T00:00:00.000Z");
const unsubscribeToken = initQueueDigestUnsubscribeToken("test-signing-key");

const CONTACT: UserContact = {
	email: "reader@example.com",
	emailVerified: true,
	queueDigestOptOutAt: undefined,
	registeredAt: REGISTERED_AT.toISOString(),
	earlyIntentionalSaves: 2,
};

function hoursAfterSignup(hours: number): Date {
	return new Date(REGISTERED_AT.getTime() + hours * 60 * 60 * 1000);
}

function buildSubject(options: { contact?: UserContact; readAtOf?: Record<string, Date | undefined>; sendEmail?: SendEmail } = {}) {
	const providers = initInMemorySubscriptionProviders({ now: () => FIRED_AT });
	const email = initInMemoryEmail();
	const articleStore = initInMemoryArticleStore();
	const lifecycleEvents: LifecycleEmailSentEvent[] = [];
	const infoLines: unknown[][] = [];
	const captureLifecycleEvent = (event: LifecycleEmailSentEvent) => { lifecycleEvents.push(event); };
	const withReadAt = (article: SavedArticle): SavedArticle => {
		const readAtOf = options.readAtOf ?? {};
		if (!(article.url in readAtOf)) return article;
		const { readAt: _readAt, ...rest } = article;
		const readAt = readAtOf[article.url];
		return readAt === undefined ? rest : { ...rest, readAt };
	};
	const findArticlesByUser: FindArticlesByUser = async (params) => {
		const result = await articleStore.findArticlesByUser(params);
		return { ...result, articles: result.articles.map(withReadAt) };
	};
	const handler = initSendTrialFeedbackEmailHandler({
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId: async () => CONTACT.email,
		findArticlesByUser,
		markTrialFeedbackEmailSent: providers.markTrialFeedbackEmailSent,
		markTrialReminderEmailSent: providers.markTrialReminderEmailSent,
		markAutomationSavesHeldEmailSent: providers.markAutomationSavesHeldEmailSent,
		claimTrialNudge: providers.claimTrialNudge,
		findUserContactByUserId: async () => options.contact ?? CONTACT,
		signUnsubscribeToken: unsubscribeToken.sign,
		sendEmail: options.sendEmail ?? email.sendEmail,
		founderAvatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		appOrigin: APP_ORIGIN,
		now: () => FIRED_AT,
		logger: HutchLogger.from({ ...noopLogger, info: (...line: unknown[]) => { infoLines.push(line); } }),
		emitLifecycleEmailSent: initEmitLifecycleEmailSent({
			logger: { info: captureLifecycleEvent, error: captureLifecycleEvent, warn: captureLifecycleEvent, debug: captureLifecycleEvent },
			now: () => FIRED_AT,
		}),
	});
	return { handler, providers, email, articleStore, lifecycleEvents, infoLines };
}

type Subject = ReturnType<typeof buildSubject>;

async function deliver(subject: Subject, messageId = "msg-day7") {
	return subject.handler(
		buildSqsEvent([{ messageId, body: JSON.stringify({ detail: { userId: USER_ID, kind: "trial_day7" } }) }]),
		buildLambdaContext(),
		() => {},
	);
}

function urlOf(slug: string): string {
	return `https://example.com/${slug}`;
}

async function save(subject: Subject, input: { slug: string; savedAt: Date; provenance?: SaveProvenance }) {
	const { saved } = await subject.articleStore.saveArticle({
		userId: USER_ID,
		url: urlOf(input.slug),
		metadata: { title: `Title ${input.slug}`, siteName: "example.com", excerpt: "", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: input.provenance ?? { kind: "web" },
		savedAt: input.savedAt,
	});
	return saved;
}

async function saveRead(subject: Subject, input: { slug: string; savedAt: Date }) {
	const article = await save(subject, input);
	await subject.articleStore.updateArticleStatus(article.id, USER_ID, "read");
}

async function seedTrial(subject: Subject) {
	await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
}

async function assertSkipped(subject: Subject, reason: string) {
	assert.deepEqual(subject.email.getSentEmails(), []);
	const row = await subject.providers.findByUserId(USER_ID);
	assert.equal(row?.trialDay7EmailSentAt, undefined);
	assert.deepEqual(subject.infoLines, [["[send-trial-feedback-email] trial_day7 noop", { userId: USER_ID, reason }]]);
}

function textOf(subject: Subject): string {
	const [message] = subject.email.getSentEmails();
	assert(message);
	assert(message.text);
	return message.text;
}

describe("trial day-7 email", () => {
	it("sends nothing when fewer than two saves landed early, and sets no marker", async () => {
		const subject = buildSubject({ contact: { ...CONTACT, earlyIntentionalSaves: 1 } });
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		await deliver(subject);

		await assertSkipped(subject, "not-eligible");
	});

	it("sends nothing to a reader who opted out", async () => {
		const subject = buildSubject({ contact: { ...CONTACT, queueDigestOptOutAt: "2026-11-07T00:00:00.000Z" } });
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		await deliver(subject);

		await assertSkipped(subject, "opted-out");
	});

	it("sends nothing when every first-week save has been read", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await saveRead(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		await deliver(subject);

		await assertSkipped(subject, "not-eligible");
	});

	it("sends nothing when no first-week save remains", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		const first = await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });
		const second = await save(subject, { slug: "two", savedAt: hoursAfterSignup(2) });
		await subject.articleStore.deleteArticle(first.id, USER_ID);
		await subject.articleStore.deleteArticle(second.id, USER_ID);

		await deliver(subject);

		await assertSkipped(subject, "not-eligible");
	});

	it("sends nothing to an active subscriber", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });
		await subject.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub", customerId: "cus" });

		await deliver(subject);

		await assertSkipped(subject, "not-trialing");
	});

	it("sends one email from the founder and records it on its trial day", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		await deliver(subject, "msg-first");
		await deliver(subject, "msg-second");

		assert.equal(subject.email.getSentEmails().length, 1);
		const [message] = subject.email.getSentEmails();
		assert(message);
		assert.equal(message.to, CONTACT.email);
		assert.equal(message.from, "Fayner from Readplace <fayner@readplace.com>");
		assert.equal(message.replyTo, "fayner@readplace.com");
		assert.equal(message.bcc, "readplace+trial_day7@readplace.com");
		assert.equal(message.idempotencyKey, `trial-day7-${USER_ID}`);
		assert.equal(message.subject, "Your readlist, a week in");
		assert.deepEqual(message.headers, {
			"List-Unsubscribe": `<${APP_ORIGIN}/email/queue-digest/unsubscribe?t=${encodeURIComponent(unsubscribeToken.sign(USER_ID))}&kind=trial-day7>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		});
		const row = await subject.providers.findByUserId(USER_ID);
		assert.equal(row?.trialDay7EmailMessageId, "msg-first");
		assert.deepEqual(subject.lifecycleEvents, [
			{
				stream: "analytics",
				event: "lifecycle_email_sent",
				timestamp: FIRED_AT.toISOString(),
				user_id: USER_ID,
				kind: "trial-day7",
				trial_day: 8,
				utm_source: "day7-email",
				delivery: "automated",
			},
		]);
	});

	it("retries a redelivered message whose send failed", async () => {
		const email = initInMemoryEmail();
		let attempts = 0;
		const subject = buildSubject({
			sendEmail: async (message) => {
				attempts += 1;
				if (attempts === 1) throw new Error("provider down");
				await email.sendEmail(message);
			},
		});
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		const failed = await deliver(subject);
		const retried = await deliver(subject);

		assert.deepEqual(failed, { batchItemFailures: [{ itemIdentifier: "msg-day7" }] });
		assert.deepEqual(retried, { batchItemFailures: [] });
		assert.equal(email.getSentEmails().length, 1);
	});

	it("carries an unsubscribe token the route accepts", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });

		await deliver(subject);

		const header = subject.email.getSentEmails()[0]?.headers?.["List-Unsubscribe"];
		assert(header);
		const token = new URL(header.slice(1, -1)).searchParams.get("t");
		assert(token);
		assert.equal(unsubscribeToken.verify(token), USER_ID);
	});

	it("leaves the read clause out when nothing was read", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });
		await save(subject, { slug: "two", savedAt: hoursAfterSignup(2) });

		await deliver(subject);

		assert.ok(textOf(subject).includes("In your first week you saved 2 articles.\n\n"));
	});

	it("lists the three oldest unread saves", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		for (let hour = 1; hour <= 5; hour += 1) {
			await save(subject, { slug: `s${hour}`, savedAt: hoursAfterSignup(hour) });
		}

		await deliver(subject);

		const text = textOf(subject);
		for (const listed of ["s1", "s2", "s3"]) assert.ok(text.includes(`- Title ${listed} — `));
		for (const omitted of ["s4", "s5"]) assert.ok(!text.includes(`- Title ${omitted} — `));
		assert.ok(text.includes("saved 5 articles."));
	});

	it("reads past one page of saves", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		for (let minute = 1; minute <= 53; minute += 1) {
			await save(subject, { slug: `m${minute}`, savedAt: new Date(REGISTERED_AT.getTime() + minute * 60_000) });
		}

		await deliver(subject);

		assert.ok(textOf(subject).includes("In your first week you saved 53 articles."));
	});

	it("counts only what was saved inside the first week, and stops reading past it", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "before", savedAt: new Date(REGISTERED_AT.getTime() - 1) });
		await save(subject, { slug: "first", savedAt: REGISTERED_AT });
		await save(subject, { slug: "last", savedAt: new Date(WINDOW_END.getTime() - 1) });
		await save(subject, { slug: "after", savedAt: WINDOW_END });

		await deliver(subject);

		const text = textOf(subject);
		assert.ok(text.includes("saved 2 articles."));
		assert.ok(!text.includes("Title before"));
		assert.ok(!text.includes("Title after"));
	});

	it("stops paging once a page reaches past the first week", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "keep", savedAt: hoursAfterSignup(1) });
		for (let minute = 1; minute <= 60; minute += 1) {
			await save(subject, { slug: `late${minute}`, savedAt: new Date(WINDOW_END.getTime() + minute * 60_000) });
		}

		await deliver(subject);

		assert.ok(textOf(subject).includes("saved 1 article."));
	});

	it("leaves automated saves out of the count and the list", async () => {
		const subject = buildSubject();
		await seedTrial(subject);
		await save(subject, { slug: "web", savedAt: hoursAfterSignup(1) });
		await save(subject, { slug: "seed", savedAt: hoursAfterSignup(2), provenance: { kind: "founder-seed" } });

		await deliver(subject);

		const text = textOf(subject);
		assert.ok(text.includes("saved 1 article."));
		assert.ok(!text.includes("Title seed"));
	});

	it("counts a read only when it happened inside the first week", async () => {
		const subject = buildSubject({
			readAtOf: {
				[urlOf("read-inside")]: hoursAfterSignup(5),
				[urlOf("read-at-end")]: WINDOW_END,
				[urlOf("read-before")]: new Date(REGISTERED_AT.getTime() - 1),
				[urlOf("read-unstamped")]: undefined,
			},
		});
		await seedTrial(subject);
		await saveRead(subject, { slug: "read-inside", savedAt: hoursAfterSignup(1) });
		await saveRead(subject, { slug: "read-at-end", savedAt: hoursAfterSignup(2) });
		await saveRead(subject, { slug: "read-before", savedAt: hoursAfterSignup(3) });
		await saveRead(subject, { slug: "read-unstamped", savedAt: hoursAfterSignup(4) });
		await save(subject, { slug: "unread", savedAt: hoursAfterSignup(6) });

		await deliver(subject);

		const text = textOf(subject);
		assert.ok(text.includes("In your first week you saved 5 articles and read 1.\n\n"));
		assert.ok(text.includes("- Title unread — "));
		assert.ok(!text.includes("- Title read-inside — "));
	});
});
