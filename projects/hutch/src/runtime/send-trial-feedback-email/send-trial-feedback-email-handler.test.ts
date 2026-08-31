import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { MarkAutomationSavesHeldEmailSent } from "@packages/provider-contracts/subscription-providers";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { FindArticlesByUser } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import {
	initSendTrialFeedbackEmailHandler,
	type SendTrialFeedbackEmailDeps,
} from "./send-trial-feedback-email-handler";

const USER_ID = UserIdSchema.parse("6".repeat(32));
const FOUNDER_AVATAR_URL = "https://static.readplace.com/fayner-brack.jpg";
const SENT_AT = new Date("2026-06-04T10:00:00.000Z");

function buildEventBridgeBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

function buildReminderBody(userId: string): string {
	return JSON.stringify({ detail: { userId, kind: "reminder" } });
}

function buildChargeReminderBody(userId: string, chargeAt?: string): string {
	return JSON.stringify({
		detail: { userId, kind: "charge_reminder", ...(chargeAt ? { chargeAt } : {}) },
	});
}

function buildPaymentFailedBody(userId: string): string {
	return JSON.stringify({ detail: { userId, kind: "payment_failed" } });
}

const HELD_EMAIL_ID = "2026-06-04T08:00:00.000Z#<news@example.com>";

const HELD_INBOX_ADDRESS = "in-3f9a2c@read.place";

function buildAutomationSavesHeldBody(
	userId: string,
	receivedAtMessageId?: string,
	inboxAddress?: string,
): string {
	return JSON.stringify({
		detail: {
			userId,
			kind: "automation_saves_held",
			...(receivedAtMessageId ? { receivedAtMessageId } : {}),
			...(inboxAddress ? { inboxAddress } : {}),
		},
	});
}

function fakeFindArticlesByUser(total: number): FindArticlesByUser {
	return async () => ({
		articles: [],
		total,
		hasMore: false,
		page: 1,
		pageSize: 20,
	});
}

interface SubjectOverrides {
	findEmail?: (userId: string) => Promise<string | null>;
	findArticlesByUser?: FindArticlesByUser;
	articlesTotal?: number;
	now?: Date;
	markAutomationSavesHeldEmailSent?: MarkAutomationSavesHeldEmailSent;
}

function buildSubject(overrides: SubjectOverrides = {}) {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-01T00:00:00.000Z"),
	});
	const email = initInMemoryEmail();
	const findEmailByUserId = overrides.findEmail ?? (async () => "user@example.com");
	const now = overrides.now ?? SENT_AT;
	const deps: SendTrialFeedbackEmailDeps = {
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId,
		findArticlesByUser:
			overrides.findArticlesByUser ??
			fakeFindArticlesByUser(overrides.articlesTotal ?? 0),
		markTrialFeedbackEmailSent: providers.markTrialFeedbackEmailSent,
		markTrialReminderEmailSent: providers.markTrialReminderEmailSent,
		markAutomationSavesHeldEmailSent:
			overrides.markAutomationSavesHeldEmailSent ?? providers.markAutomationSavesHeldEmailSent,
		sendEmail: email.sendEmail,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		appOrigin: "https://readplace.com",
		now: () => now,
		logger: HutchLogger.from(noopLogger),
	};
	const handler = initSendTrialFeedbackEmailHandler(deps);
	return { handler, providers, email };
}

async function seedCancelledTrial(
	providers: ReturnType<typeof initInMemorySubscriptionProviders>,
): Promise<void> {
	await providers.upsertTrialing({
		userId: USER_ID,
		trialEndsAt: "2026-06-05T00:00:00.000Z",
	});
	await providers.markCancelledByUserId({ userId: USER_ID });
}

describe("automation-saves-held notice", () => {
	const run = async (subject: ReturnType<typeof buildSubject>, emailId = HELD_EMAIL_ID) =>
		subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-held",
					body: buildAutomationSavesHeldBody(USER_ID, emailId, HELD_INBOX_ADDRESS),
				},
			]),
			buildLambdaContext(),
			() => {},
		);

	it("sends the notice and claims the marker for a read-only reader", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);

		const result = await run(subject);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const sentEmails = subject.email.getSentEmails();
		assert.equal(sentEmails.length, 1);
		const sent = sentEmails[0];
		assert(sent, "the notice must have been sent");
		assert(sent.text, "the notice must carry a plain-text alternative");
		assert.equal(sent.to, "user@example.com");
		assert.equal(sent.bcc, "readplace+automation_saves_held@readplace.com");
		assert.equal(sent.subject, "links sent to your Readplace inbox are waiting");
		assert.ok(
			sent.text.startsWith(
				`An email to your Readplace inbox at ${HELD_INBOX_ADDRESS} just arrived,`,
			),
		);
		assert.ok(
			sent.html.includes(
				`<span style="white-space:nowrap;">${HELD_INBOX_ADDRESS}</span>`,
			),
			"the hyphenated address must be unbreakable and byte-exact in the HTML",
		);
		const highlighted = new URL(
			"https://readplace.com/inbox?highlight=2026-06-04T08%3A00%3A00.000Z%23%3Cnews%40example.com%3E&utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save",
		);
		assert.ok(sent.text.includes(highlighted.toString()));
		assert.equal(
			new URL(highlighted).searchParams.get("highlight"),
			HELD_EMAIL_ID,
		);
		assert.ok(sent.text.includes("https://readplace.com/inbox/addresses?utm_source="));
		assert.ok(sent.text.includes("https://readplace.com/account?utm_source="));
		assert.equal(
			(await subject.providers.findByUserId(USER_ID))?.automationSavesHeldEmailSentAt,
			SENT_AT.toISOString(),
		);
	});

	it("sends only once per lapse however many emails are held", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);

		await run(subject);
		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 1);
	});

	it("sends again after a reactivation cleared the marker and access lapsed anew", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);
		await run(subject);

		await subject.providers.markActive({ userId: USER_ID });
		await subject.providers.markCancelledByUserId({ userId: USER_ID });
		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 2);
	});

	it("links to the plain inbox list when the command names no email", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);

		await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-held-bare", body: buildAutomationSavesHeldBody(USER_ID) },
			]),
			buildLambdaContext(),
			() => {},
		);

		const sent = subject.email.getSentEmails()[0];
		assert(sent?.text, "the notice must carry a plain-text alternative");
		assert.ok(sent.text.includes("https://readplace.com/inbox?utm_source="));
	});

	it("stays silent for a reader who can still save", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("stays silent for a reader with no subscription row, who has full access", async () => {
		const subject = buildSubject();

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("stays silent when no email is on file, leaving the marker unclaimed", async () => {
		const subject = buildSubject({ findEmail: async () => null });
		await seedCancelledTrial(subject.providers);

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
		assert.equal(
			(await subject.providers.findByUserId(USER_ID))?.automationSavesHeldEmailSentAt,
			undefined,
		);
	});

	it("stays silent when an earlier delivery already recorded the notice", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);
		await subject.providers.markAutomationSavesHeldEmailSent({
			userId: USER_ID,
			sentAt: "2026-06-03T00:00:00.000Z",
		});

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("sends nothing when a concurrent delivery wins the marker claim", async () => {
		const subject = buildSubject({
			markAutomationSavesHeldEmailSent: async () => "already-sent",
		});
		await seedCancelledTrial(subject.providers);

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
	});
});

describe("send-trial-feedback-email handler", () => {
	it("sends the email and marks the row as sent on the happy path", async () => {
		const subject = buildSubject({ articlesTotal: 9 });
		await seedCancelledTrial(subject.providers);

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-ok", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.email.getSentEmails().length, 1);
		const sent = subject.email.getSentEmails()[0];
		assert.equal(sent.to, "user@example.com");
		assert.equal(sent.from, "Fayner from Readplace <fayner@readplace.com>");
		assert.equal(sent.replyTo, "fayner@readplace.com");
		assert.equal(sent.bcc, "readplace+trial_feedback@readplace.com");
		assert.equal(sent.subject, "you tried Readplace — what was missing?");
		assert.ok(sent.text);
		assert.ok(sent.text.includes("saved 9 articles"));
		assert.ok(sent.html.includes("saved 9 articles"));
		assert.ok(sent.html.includes("fayner-brack.jpg"));

		const row = await subject.providers.findByUserId(USER_ID);
		assert(row, "row must still exist");
		assert.equal(row.trialFeedbackEmailSentAt, SENT_AT.toISOString());
	});

	it("omits the saved-articles clause when the user saved zero — never fabricates usage", async () => {
		const subject = buildSubject({ articlesTotal: 0 });
		await seedCancelledTrial(subject.providers);

		await subject.handler(
			buildSqsEvent([{ messageId: "msg-zero", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		const sent = subject.email.getSentEmails()[0];
		assert.ok(sent.text);
		assert.ok(!sent.text.includes("saved"));
		assert.ok(!sent.text.includes("article"));
	});

	it("noops when the user reactivated during the delay window (status='trialing')", async () => {
		const subject = buildSubject({ articlesTotal: 5 });
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-05T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-reactivated", body: buildEventBridgeBody(USER_ID) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.email.getSentEmails().length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.trialFeedbackEmailSentAt, undefined);
	});

	it("noops when the user reactivated and is now status='active' (paid)", async () => {
		const subject = buildSubject({ articlesTotal: 5 });
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});

		await subject.handler(
			buildSqsEvent([{ messageId: "msg-active", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("noops when the email was already sent — deterministic schedule + sent flag => at most one email", async () => {
		const subject = buildSubject({ articlesTotal: 5 });
		await seedCancelledTrial(subject.providers);
		await subject.providers.markTrialFeedbackEmailSent({
			userId: USER_ID,
			sentAt: "2026-06-04T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-dup", body: buildEventBridgeBody(USER_ID) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("noops when there is no subscription row at all", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-missing", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("noops when there is no email on file for the user", async () => {
		const subject = buildSubject({
			articlesTotal: 5,
			findEmail: async () => null,
		});
		await seedCancelledTrial(subject.providers);

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-no-email", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.email.getSentEmails().length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.trialFeedbackEmailSentAt, undefined);
	});

	it("singularises the saved-articles clause when the user saved exactly one article", async () => {
		const subject = buildSubject({ articlesTotal: 1 });
		await seedCancelledTrial(subject.providers);

		await subject.handler(
			buildSqsEvent([{ messageId: "msg-one", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		const sent = subject.email.getSentEmails()[0];
		assert.ok(sent.text);
		assert.ok(sent.text.includes("saved 1 article"));
		assert.ok(!sent.text.includes("saved 1 articles"));
	});

	it("reports a batch item failure when sendEmail throws", async () => {
		const providers = initInMemorySubscriptionProviders({
			now: () => new Date("2026-06-01T00:00:00.000Z"),
		});
		await providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-05T00:00:00.000Z",
		});
		await providers.markCancelledByUserId({ userId: USER_ID });

		const handler = initSendTrialFeedbackEmailHandler({
			findSubscriptionByUserId: providers.findByUserId,
			findEmailByUserId: async () => "user@example.com",
			findArticlesByUser: fakeFindArticlesByUser(2),
			markTrialFeedbackEmailSent: providers.markTrialFeedbackEmailSent,
			markTrialReminderEmailSent: providers.markTrialReminderEmailSent,
			markAutomationSavesHeldEmailSent: providers.markAutomationSavesHeldEmailSent,
			sendEmail: async () => {
				throw new Error("Resend rejected");
			},
			founderAvatarUrl: FOUNDER_AVATAR_URL,
			appOrigin: "https://readplace.com",
			now: () => SENT_AT,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-fail", body: buildEventBridgeBody(USER_ID) }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
		const row = await providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.trialFeedbackEmailSentAt, undefined);
	});

	it("reports a batch item failure, and sends nothing, when the store answers the includeTotal query without a total", async () => {
		const subject = buildSubject({
			findArticlesByUser: async () => ({
				articles: [],
				hasMore: false,
				page: 1,
				pageSize: 20,
			}),
		});
		await seedCancelledTrial(subject.providers);

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-no-total", body: buildEventBridgeBody(USER_ID) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-no-total");
		assert.equal(subject.email.getSentEmails().length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.trialFeedbackEmailSentAt, undefined);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "not-json" }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when the envelope is missing userId", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-schema", body: JSON.stringify({ detail: {} }) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	describe("kind='reminder' — pre-expiry trial reminder", () => {
		async function seedFutureTrial(
			providers: ReturnType<typeof initInMemorySubscriptionProviders>,
		): Promise<void> {
			await providers.upsertTrialing({
				userId: USER_ID,
				trialEndsAt: "2026-06-20T00:00:00.000Z",
			});
		}

		it("sends the reminder and marks the reminder flag without touching the feedback flag", async () => {
			const subject = buildSubject({ articlesTotal: 3 });
			await seedFutureTrial(subject.providers);

			const result = await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert(result);
			assert.equal(result.batchItemFailures.length, 0);
			assert.equal(subject.email.getSentEmails().length, 1);
			const sent = subject.email.getSentEmails()[0];
			assert.equal(sent.to, "user@example.com");
			assert.equal(sent.from, "Fayner from Readplace <fayner@readplace.com>");
			assert.equal(sent.replyTo, "fayner@readplace.com");
			assert.equal(sent.bcc, "readplace+trial_reminder@readplace.com");
			assert.equal(sent.subject, "your Readplace trial ends in 2 days");
			assert.ok(sent.text);
			assert.ok(sent.text.includes("/account?utm_source=trial-reminder"));
			assert.ok(sent.html.includes("trial-reminder"));

			const row = await subject.providers.findByUserId(USER_ID);
			assert(row, "row must still exist");
			assert.equal(row.trialReminderEmailSentAt, SENT_AT.toISOString());
			assert.equal(row.trialFeedbackEmailSentAt, undefined);
		});

		it("noops when the user is no longer trialing (cancelled)", async () => {
			const subject = buildSubject({ articlesTotal: 3 });
			await seedCancelledTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-cancelled", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when trialEndsAt is already in the past (clock skew / stale schedule)", async () => {
			const subject = buildSubject({
				articlesTotal: 3,
				now: new Date("2026-06-21T00:00:00.000Z"),
			});
			await seedFutureTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-past", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
		});

		it("noops when the reminder was already sent — at most one reminder", async () => {
			const subject = buildSubject({ articlesTotal: 3 });
			await seedFutureTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-1", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);
			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-2", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 1);
		});

		it("noops when there is no subscription row at all", async () => {
			const subject = buildSubject({ articlesTotal: 3 });

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-missing", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when there is no email on file", async () => {
			const subject = buildSubject({ articlesTotal: 3, findEmail: async () => null });
			await seedFutureTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-no-email", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
		});

		it("omits the saved-articles clause when the user saved zero", async () => {
			const subject = buildSubject({ articlesTotal: 0 });
			await seedFutureTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-zero", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			const sent = subject.email.getSentEmails()[0];
			assert.ok(sent.text);
			assert.ok(!sent.text.includes("stay readable either way"));
		});

		it("a body WITHOUT kind still runs the feedback path (backward compatible)", async () => {
			const subject = buildSubject({ articlesTotal: 4 });
			await seedCancelledTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-nokind", body: buildEventBridgeBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 1);
			const sent = subject.email.getSentEmails()[0];
			assert.equal(sent.subject, "you tried Readplace — what was missing?");
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialFeedbackEmailSentAt, SENT_AT.toISOString());
			assert.equal(row.trialReminderEmailSentAt, undefined);
		});
	});

	describe("kind='charge_reminder' — pre-charge notice for a trial-preserving checkout", () => {
		const CHARGE_AT = "2026-06-06T00:00:00.000Z";

		async function seedActiveSubscriber(
			providers: ReturnType<typeof initInMemorySubscriptionProviders>,
		): Promise<void> {
			await providers.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_trial_preserving",
				customerId: "cus_trial_preserving",
			});
		}

		it("sends the charge reminder with the price + charge date and marks the reminder flag", async () => {
			const subject = buildSubject();
			await seedActiveSubscriber(subject.providers);

			const result = await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert(result);
			assert.equal(result.batchItemFailures.length, 0);
			assert.equal(subject.email.getSentEmails().length, 1);
			const sent = subject.email.getSentEmails()[0];
			assert.equal(sent.to, "user@example.com");
			assert.equal(sent.from, "Fayner from Readplace <fayner@readplace.com>");
			assert.equal(sent.replyTo, "fayner@readplace.com");
			assert.equal(sent.bcc, "readplace+charge_reminder@readplace.com");
			assert.equal(sent.subject, "your Readplace membership starts on Jun 6, 2026");
			assert.ok(sent.text);
			assert.ok(sent.text.includes("$49 for the year"));
			assert.ok(sent.text.includes("charged to the card on file on Jun 6, 2026"));
			assert.ok(sent.text.includes("/account?utm_source=charge-reminder"));
			assert.ok(sent.html.includes("charge-reminder"));

			const row = await subject.providers.findByUserId(USER_ID);
			assert(row, "row must still exist");
			assert.equal(row.trialReminderEmailSentAt, SENT_AT.toISOString());
		});

		it("noops with a warn when the command carries no chargeAt", async () => {
			const subject = buildSubject();
			await seedActiveSubscriber(subject.providers);

			const result = await subject.handler(
				buildSqsEvent([{ messageId: "msg-cr-nocharge", body: buildChargeReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert(result);
			assert.equal(result.batchItemFailures.length, 0);
			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when there is no subscription row at all", async () => {
			const subject = buildSubject();

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-missing", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when the user is no longer active (cancelled before the reminder fired)", async () => {
			const subject = buildSubject();
			await seedCancelledTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-cancelled", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when the charge instant has already passed (stale schedule)", async () => {
			const subject = buildSubject({ now: new Date("2026-06-07T00:00:00.000Z") });
			await seedActiveSubscriber(subject.providers);

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-past", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
		});

		it("noops when a pre-trial-end reminder was already sent — at most one reminder per user", async () => {
			const subject = buildSubject();
			await seedActiveSubscriber(subject.providers);
			await subject.providers.markTrialReminderEmailSent({
				userId: USER_ID,
				sentAt: "2026-06-03T00:00:00.000Z",
			});

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-dup", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when there is no email on file", async () => {
			const subject = buildSubject({ findEmail: async () => null });
			await seedActiveSubscriber(subject.providers);

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-noemail", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
		});
	});

	describe("kind='payment_failed' — fix-your-card dunning email", () => {
		async function seedActiveSubscriber(
			providers: ReturnType<typeof initInMemorySubscriptionProviders>,
		): Promise<void> {
			await providers.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_dunning",
				customerId: "cus_dunning",
			});
		}

		it("sends the payment-failed email to an active subscriber without stamping any sent flag — each dunning attempt is a distinct failure worth an email", async () => {
			const subject = buildSubject();
			await seedActiveSubscriber(subject.providers);

			const result = await subject.handler(
				buildSqsEvent([{ messageId: "msg-pf", body: buildPaymentFailedBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert(result);
			assert.equal(result.batchItemFailures.length, 0);
			assert.equal(subject.email.getSentEmails().length, 1);
			const sent = subject.email.getSentEmails()[0];
			assert.equal(sent.to, "user@example.com");
			assert.equal(sent.bcc, "readplace+payment_failed@readplace.com");
			assert.equal(sent.subject, "your Readplace payment didn't go through");
			assert.ok(sent.text);
			assert.ok(sent.text.includes("/account?utm_source=payment-failed"));

			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
			assert.equal(row.trialFeedbackEmailSentAt, undefined);
		});

		it("noops when there is no subscription row at all", async () => {
			const subject = buildSubject();

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-pf-missing", body: buildPaymentFailedBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when the user is no longer active", async () => {
			const subject = buildSubject();
			await seedCancelledTrial(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-pf-cancelled", body: buildPaymentFailedBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});

		it("noops when there is no email on file", async () => {
			const subject = buildSubject({ findEmail: async () => null });
			await seedActiveSubscriber(subject.providers);

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-pf-noemail", body: buildPaymentFailedBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 0);
		});
	});
});
