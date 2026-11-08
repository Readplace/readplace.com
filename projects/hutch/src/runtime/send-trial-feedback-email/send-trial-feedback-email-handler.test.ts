import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { MarkAutomationSavesHeldEmailSent } from "@packages/provider-contracts/subscription-providers";
import {
	EmailKeyReusedError,
	EmailRejectedError,
	type EmailMessage,
	type SendEmail,
} from "@packages/provider-contracts/email";
import {
	type FindOpenInvoiceFailure,
	InvoiceIdSchema,
} from "@packages/provider-contracts/subscription-billing";
import { Logger, noopLogger } from "@packages/logger";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { FindArticlesByUser } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import {
	initEmitLifecycleEmailSent,
	type LifecycleEmailSentEvent,
} from "../observability/lifecycle-email-events";
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

type ResendStep = "accept-then-5xx" | "refuse-429" | "refuse-concurrent";

function initResendLikeEmail(): {
	sendEmail: SendEmail;
	delivered: EmailMessage[];
	failNext: (...steps: ResendStep[]) => void;
} {
	const delivered: EmailMessage[] = [];
	const recorded = new Map<string, string>();
	const steps: ResendStep[] = [];
	const sendEmail: SendEmail = async (message) => {
		const step = steps.shift();
		if (step === "refuse-429") {
			throw new EmailRejectedError({ statusCode: 429, message: "Resend rate_limit_exceeded" });
		}
		if (step === "refuse-concurrent") {
			throw new EmailRejectedError({
				statusCode: 409,
				message: "Resend concurrent_idempotent_requests",
			});
		}
		const { idempotencyKey, ...payload } = message;
		assert(idempotencyKey, "every keyed send carries an idempotency key");
		const body = JSON.stringify(payload);
		const previous = recorded.get(idempotencyKey);
		if (previous === body) return;
		if (previous !== undefined) {
			throw new EmailKeyReusedError({
				statusCode: 409,
				message: "Resend invalid_idempotent_request",
			});
		}
		recorded.set(idempotencyKey, body);
		delivered.push(message);
		if (step === "accept-then-5xx") {
			throw new Error("Resend internal_server_error");
		}
	};
	return { sendEmail, delivered, failNext: (...next) => steps.push(...next) };
}

const OPEN_FAILURE = { invoiceId: InvoiceIdSchema.parse("in_1Open"), attemptCount: 1 };

interface SubjectOverrides {
	findEmail?: (userId: string) => Promise<string | null>;
	findArticlesByUser?: FindArticlesByUser;
	articlesTotal?: number;
	now?: Date;
	markAutomationSavesHeldEmailSent?: MarkAutomationSavesHeldEmailSent;
	logger?: Logger;
	sendEmail?: SendTrialFeedbackEmailDeps["sendEmail"];
	findOpenInvoiceFailure?: FindOpenInvoiceFailure;
	markFailures?: { remaining: number };
}

function buildSubject(overrides: SubjectOverrides = {}) {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-01T00:00:00.000Z"),
	});
	const email = initInMemoryEmail();
	const findEmailByUserId = overrides.findEmail ?? (async () => "user@example.com");
	const now = overrides.now ?? SENT_AT;
	const lifecycleEvents: LifecycleEmailSentEvent[] = [];
	const captureLifecycleEvent = (event: LifecycleEmailSentEvent) => { lifecycleEvents.push(event); };
	const markFailures = overrides.markFailures ?? { remaining: 0 };
	const failingMark = <Input>(mark: (input: Input) => Promise<void>) => async (input: Input) => {
		if (markFailures.remaining > 0) {
			markFailures.remaining -= 1;
			throw new Error("DynamoDB UpdateItem failed");
		}
		await mark(input);
	};
	const deps: SendTrialFeedbackEmailDeps = {
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId,
		findArticlesByUser:
			overrides.findArticlesByUser ??
			fakeFindArticlesByUser(overrides.articlesTotal ?? 0),
		markTrialFeedbackEmailSent: failingMark(providers.markTrialFeedbackEmailSent),
		markTrialReminderEmailSent: failingMark(providers.markTrialReminderEmailSent),
		markAutomationSavesHeldEmailSent:
			overrides.markAutomationSavesHeldEmailSent ?? providers.markAutomationSavesHeldEmailSent,
		markPaymentFailedEmailSent: failingMark(providers.markPaymentFailedEmailSent),
		findOpenInvoiceFailure: overrides.findOpenInvoiceFailure ?? (async () => OPEN_FAILURE),
		claimTrialNudge: providers.claimTrialNudge,
		releaseTrialNudge: providers.releaseTrialNudge,
		findUserContactByUserId: async () => null,
		signUnsubscribeToken: () => "signed-token",
		sendEmail: overrides.sendEmail ?? email.sendEmail,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		appOrigin: "https://readplace.com",
		now: () => now,
		logger: overrides.logger ?? Logger.from(noopLogger),
		emitLifecycleEmailSent: initEmitLifecycleEmailSent({
			logger: { info: captureLifecycleEvent, error: captureLifecycleEvent, warn: captureLifecycleEvent, debug: captureLifecycleEvent },
			now: () => now,
		}),
	};
	const handler = initSendTrialFeedbackEmailHandler(deps);
	return { handler, providers, email, lifecycleEvents };
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
		assert.equal(sent.subject, "links sent to your Readplace Inbox are waiting");
		assert.equal(sent.replyTo, "fayner@readplace.com");
		assert.ok(
			sent.text.includes("If you have any questions, please reply to this email"),
			"the reply invitation must render — it is only honest because replyTo is asserted above",
		);
		assert.ok(
			sent.text.startsWith(
				`An email to ${HELD_INBOX_ADDRESS} just arrived in your Readplace Inbox,`,
			),
		);
		assert.ok(
			sent.html.includes(
				`<span style="display:inline-block;overflow-wrap:anywhere;word-break:break-word;font-weight:700;">${HELD_INBOX_ADDRESS}</span>`,
			),
			"the hyphenated address must be bold and byte-exact in the HTML",
		);
		const highlighted = new URL(
			"https://readplace.com/inbox?highlight=2026-06-04T08%3A00%3A00.000Z%23%3Cnews%40example.com%3E&utm_source=automation-saves-held&utm_medium=email&utm_campaign=lapsed-inbox-save",
		);
		assert.ok(sent.text.includes(highlighted.toString()));
		assert.equal(
			new URL(highlighted).searchParams.get("highlight"),
			HELD_EMAIL_ID,
		);
		assert.ok(sent.text.includes("https://readplace.com/newsletters/custom-emails?utm_source="));
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
		assert.equal(sent.from, "Readplace <readplace@readplace.com>");
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
			markPaymentFailedEmailSent: providers.markPaymentFailedEmailSent,
			findOpenInvoiceFailure: async () => undefined,
			claimTrialNudge: providers.claimTrialNudge,
			releaseTrialNudge: providers.releaseTrialNudge,
			findUserContactByUserId: async () => null,
			signUnsubscribeToken: () => "signed-token",
			sendEmail: async () => {
				throw new Error("Resend rejected");
			},
			founderAvatarUrl: FOUNDER_AVATAR_URL,
			appOrigin: "https://readplace.com",
			now: () => SENT_AT,
			logger: Logger.from(noopLogger),
			emitLifecycleEmailSent: () => {},
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
			assert.equal(sent.from, "Readplace <readplace@readplace.com>");
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

		it("noops when this trial's pay digest was already sent — the pay digest replaces the day-12 reminder", async () => {
			const info = jest.fn();
			const subject = buildSubject({
				articlesTotal: 3,
				now: new Date("2026-06-18T00:00:00.000Z"),
				logger: Logger.from({ ...noopLogger, info }),
			});
			await seedFutureTrial(subject.providers);
			const claim = await subject.providers.claimPayDigest({
				userId: USER_ID,
				trialEndsAt: "2026-06-20T00:00:00.000Z",
				messageId: "msg-pay",
				now: new Date("2026-06-16T06:00:00.000Z"),
				urls: ["https://example.com/listed"],
			});
			assert.deepEqual(claim, { claimed: true, redelivery: false });

			const result = await subject.handler(
				buildSqsEvent([{ messageId: "msg-rem-after-pay", body: buildReminderBody(USER_ID) }]),
				buildLambdaContext(),
				() => {},
			);

			assert(result);
			assert.equal(result.batchItemFailures.length, 0);
			assert.equal(subject.email.getSentEmails().length, 0);
			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.trialReminderEmailSentAt, undefined);
			expect(info).toHaveBeenCalledWith(
				"[send-trial-feedback-email] reminder: pay digest already sent — noop",
				{ userId: USER_ID, sentAt: "2026-06-16T06:00:00.000Z" },
			);
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
			assert.equal(sent.from, "Readplace <readplace@readplace.com>");
			assert.equal(sent.replyTo, "fayner@readplace.com");
			assert.equal(sent.bcc, "readplace+charge_reminder@readplace.com");
			assert.equal(sent.subject, "your Readplace membership starts on Jun 6, 2026");
			assert.ok(sent.text);
			assert.ok(sent.text.includes("the plan you are on is charged to the card on file"));
			assert.ok(sent.text.includes("charged to the card on file on Jun 6, 2026"));
			assert.ok(sent.text.includes("/account?utm_source=charge-reminder"));
			assert.ok(sent.html.includes("charge-reminder"));

			const row = await subject.providers.findByUserId(USER_ID);
			assert(row, "row must still exist");
			assert.equal(row.trialReminderEmailSentAt, SENT_AT.toISOString());
		});

		it("names the yearly total and cadence when the row carries the plan the checkout was charged on", async () => {
			const subject = buildSubject();
			await subject.providers.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_trial_preserving",
				customerId: "cus_trial_preserving",
				plan: "yearly",
			});

			await subject.handler(
				buildSqsEvent([
					{ messageId: "msg-cr-yearly", body: buildChargeReminderBody(USER_ID, CHARGE_AT) },
				]),
				buildLambdaContext(),
				() => {},
			);

			assert.equal(subject.email.getSentEmails().length, 1);
			const sent = subject.email.getSentEmails()[0];
			assert.ok(sent.text);
			assert.ok(sent.text.includes("$60 charged to the card on file"));
			assert.ok(sent.text.includes("once a year after that"));
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

		it("sends for an open invoice failure, records the attempt, and keys the send on invoice and attempt", async () => {
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
			assert.equal(sent.idempotencyKey, "payment-failed/in_1Open/1");

			const row = await subject.providers.findByUserId(USER_ID);
			assert(row);
			assert.equal(row.paymentFailedEmailAttempt, "in_1Open/1");
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

describe("a redrive of a keyed kind", () => {
	const TRIAL_ENDS_AT = "2026-06-20T00:00:00.000Z";
	const CHARGE_AT = "2026-06-06T00:00:00.000Z";

	type Subject = ReturnType<typeof buildSubject>;
	type KeyedCase = {
		kind: string;
		body: string;
		key: string;
		seed: (subject: Subject) => Promise<void>;
		changePayload: (subject: Subject, articles: { total: number }) => Promise<void>;
		marker: (row: NonNullable<Awaited<ReturnType<Subject["providers"]["findByUserId"]>>>) => string | undefined;
	};

	const CASES: KeyedCase[] = [
		{
			kind: "feedback",
			body: buildEventBridgeBody(USER_ID),
			key: `trial-feedback/${USER_ID}`,
			seed: (subject) => seedCancelledTrial(subject.providers),
			changePayload: async (_subject, articles) => {
				articles.total += 1;
			},
			marker: (row) => row.trialFeedbackEmailSentAt,
		},
		{
			kind: "reminder",
			body: buildReminderBody(USER_ID),
			key: `trial-reminder/${USER_ID}/${TRIAL_ENDS_AT}`,
			seed: (subject) =>
				subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT }),
			changePayload: async (_subject, articles) => {
				articles.total += 1;
			},
			marker: (row) => row.trialReminderEmailSentAt,
		},
		{
			kind: "charge_reminder",
			body: buildChargeReminderBody(USER_ID, CHARGE_AT),
			key: `charge-reminder/${USER_ID}/${CHARGE_AT}`,
			seed: (subject) =>
				subject.providers.upsertActive({
					userId: USER_ID,
					subscriptionId: "sub_trial_preserving",
					customerId: "cus_trial_preserving",
				}),
			changePayload: (subject) =>
				subject.providers.upsertActive({
					userId: USER_ID,
					subscriptionId: "sub_trial_preserving",
					customerId: "cus_trial_preserving",
					plan: "yearly",
				}),
			marker: (row) => row.trialReminderEmailSentAt,
		},
	];

	function setUp(markFailures = { remaining: 0 }) {
		const resend = initResendLikeEmail();
		const articles = { total: 4 };
		const subject = buildSubject({
			sendEmail: resend.sendEmail,
			markFailures,
			findArticlesByUser: async () => ({
				articles: [],
				total: articles.total,
				hasMore: false,
				page: 1,
				pageSize: 20,
			}),
		});
		return { resend, articles, subject };
	}

	async function deliver(subject: Subject, body: string) {
		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-keyed", body }]),
			buildLambdaContext(),
			() => {},
		);
		assert(result);
		return result.batchItemFailures.length;
	}

	async function markerOf(subject: Subject, testCase: KeyedCase) {
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row, "row must still exist");
		return testCase.marker(row);
	}

	describe.each(CASES)("kind=$kind", (testCase) => {
		it("sends with the kind's idempotency key", async () => {
			const { resend, subject } = setUp();
			await testCase.seed(subject);

			assert.equal(await deliver(subject, testCase.body), 0);

			assert.deepEqual(
				resend.delivered.map((message) => message.idempotencyKey),
				[testCase.key],
			);
		});

		it("run twice after an accepted send answered 5xx delivers one email and writes the marker", async () => {
			const { resend, subject } = setUp();
			await testCase.seed(subject);
			resend.failNext("accept-then-5xx");

			assert.equal(await deliver(subject, testCase.body), 1);
			assert.equal(await markerOf(subject, testCase), undefined);
			assert.equal(await deliver(subject, testCase.body), 0);

			assert.equal(resend.delivered.length, 1);
			assert.equal(await markerOf(subject, testCase), SENT_AT.toISOString());
		});

		it("a mark failure after an accepted send delivers one email once the retry succeeds", async () => {
			const { resend, subject } = setUp({ remaining: 1 });
			await testCase.seed(subject);

			assert.equal(await deliver(subject, testCase.body), 1);
			assert.equal(await deliver(subject, testCase.body), 0);

			assert.equal(resend.delivered.length, 1);
			assert.equal(await markerOf(subject, testCase), SENT_AT.toISOString());
		});

		it("a changed payload on retry counts as sent and writes the marker", async () => {
			const { resend, articles, subject } = setUp();
			await testCase.seed(subject);
			resend.failNext("accept-then-5xx");

			assert.equal(await deliver(subject, testCase.body), 1);
			await testCase.changePayload(subject, articles);
			assert.equal(await deliver(subject, testCase.body), 0);

			assert.equal(resend.delivered.length, 1);
			assert.equal(await markerOf(subject, testCase), SENT_AT.toISOString());
		});

		it("a concurrent-request refusal fails the record and writes no marker", async () => {
			const { resend, subject } = setUp();
			await testCase.seed(subject);
			resend.failNext("refuse-concurrent");

			assert.equal(await deliver(subject, testCase.body), 1);

			assert.equal(resend.delivered.length, 0);
			assert.equal(await markerOf(subject, testCase), undefined);
		});

		it("a refusal, then a later success, delivers one email and writes the marker", async () => {
			const { resend, subject } = setUp();
			await testCase.seed(subject);
			resend.failNext("refuse-429");

			assert.equal(await deliver(subject, testCase.body), 1);
			assert.equal(await deliver(subject, testCase.body), 0);

			assert.equal(resend.delivered.length, 1);
			assert.equal(await markerOf(subject, testCase), SENT_AT.toISOString());
		});
	});
});

describe("a redrive of payment_failed", () => {
	const INVOICE = InvoiceIdSchema.parse("in_1Open");
	const NEXT_INVOICE = InvoiceIdSchema.parse("in_2Next");
	const body = buildPaymentFailedBody(USER_ID);

	type Subject = ReturnType<typeof buildSubject>;

	function setUp(input: {
		stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> | Error };
		markFailures?: { remaining: number };
		findEmail?: (userId: string) => Promise<string | null>;
	}) {
		const resend = initResendLikeEmail();
		const askedFor: string[] = [];
		const subject = buildSubject({
			sendEmail: resend.sendEmail,
			...(input.markFailures ? { markFailures: input.markFailures } : {}),
			...(input.findEmail ? { findEmail: input.findEmail } : {}),
			findOpenInvoiceFailure: async ({ subscriptionId }) => {
				askedFor.push(subscriptionId);
				const { answer } = input.stripe;
				if (answer instanceof Error) throw answer;
				return answer;
			},
		});
		return { resend, askedFor, subject };
	}

	async function seedDunning(subject: Subject, subscriptionId = "sub_dunning") {
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId,
			customerId: "cus_dunning",
		});
	}

	async function deliver(subject: Subject) {
		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-pf-redrive", body }]),
			buildLambdaContext(),
			() => {},
		);
		assert(result);
		return result.batchItemFailures.length;
	}

	async function emailedAttempt(subject: Subject) {
		return (await subject.providers.findByUserId(USER_ID))?.paymentFailedEmailAttempt;
	}

	it("a paid invoice sends nothing and records nothing", async () => {
		const stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> } = {
			answer: { invoiceId: INVOICE, attemptCount: 1 },
		};
		const { resend, subject } = setUp({ stripe });
		await seedDunning(subject);
		stripe.answer = undefined;

		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 0);
		assert.equal(await emailedAttempt(subject), undefined);
	});

	it("run twice for one attempt delivers one email", async () => {
		const { resend, subject } = setUp({ stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } } });
		await seedDunning(subject);

		await deliver(subject);
		await deliver(subject);

		assert.equal(resend.delivered.length, 1);
		assert.equal(await emailedAttempt(subject), "in_1Open/1");
	});

	it("a second attempt on the same invoice delivers a second email and records attempt 2", async () => {
		const stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> } = {
			answer: { invoiceId: INVOICE, attemptCount: 1 },
		};
		const { resend, subject } = setUp({ stripe });
		await seedDunning(subject);

		await deliver(subject);
		stripe.answer = { invoiceId: INVOICE, attemptCount: 2 };
		await deliver(subject);

		assert.deepEqual(
			resend.delivered.map((message) => message.idempotencyKey),
			["payment-failed/in_1Open/1", "payment-failed/in_1Open/2"],
		);
		assert.equal(await emailedAttempt(subject), "in_1Open/2");
	});

	it("a stale redrive after the next attempt was emailed delivers nothing and leaves the attempt at 2", async () => {
		const { resend, subject } = setUp({ stripe: { answer: { invoiceId: INVOICE, attemptCount: 2 } } });
		await seedDunning(subject);
		await deliver(subject);

		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 1);
		assert.equal(await emailedAttempt(subject), "in_1Open/2");
	});

	it("a redrive before the next attempt's own message sends for that attempt, and the later message no-ops", async () => {
		const stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> } = {
			answer: { invoiceId: INVOICE, attemptCount: 1 },
		};
		const { resend, subject } = setUp({ stripe });
		await seedDunning(subject);
		await deliver(subject);
		stripe.answer = { invoiceId: INVOICE, attemptCount: 2 };

		await deliver(subject);
		await deliver(subject);

		assert.deepEqual(
			resend.delivered.map((message) => message.idempotencyKey),
			["payment-failed/in_1Open/1", "payment-failed/in_1Open/2"],
		);
		assert.equal(await emailedAttempt(subject), "in_1Open/2");
	});

	it("a later invoice's failure delivers a new email", async () => {
		const stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> } = {
			answer: { invoiceId: INVOICE, attemptCount: 1 },
		};
		const { resend, subject } = setUp({ stripe });
		await seedDunning(subject);
		await deliver(subject);
		stripe.answer = { invoiceId: NEXT_INVOICE, attemptCount: 1 };

		await deliver(subject);

		assert.equal(resend.delivered.length, 2);
		assert.equal(await emailedAttempt(subject), "in_2Next/1");
	});

	it("a row without a subscription id sends nothing and never calls Stripe", async () => {
		const { resend, askedFor, subject } = setUp({
			stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } },
		});
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "active",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});

		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 0);
		assert.deepEqual(askedFor, []);
		assert.equal(await emailedAttempt(subject), undefined);
	});

	it("a new subscription's open failure is what the read asks for", async () => {
		const { askedFor, subject } = setUp({
			stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } },
		});
		await seedDunning(subject, "sub_old");
		await seedDunning(subject, "sub_new");

		await deliver(subject);

		assert.deepEqual(askedFor, ["sub_new"]);
	});

	it("a Stripe read failure reports a batch item failure, and a later delivery heals", async () => {
		const stripe: { answer: Awaited<ReturnType<FindOpenInvoiceFailure>> | Error } = {
			answer: new Error("Stripe findOpenInvoiceFailure failed (500): boom"),
		};
		const { resend, subject } = setUp({ stripe });
		await seedDunning(subject);

		assert.equal(await deliver(subject), 1);
		assert.equal(resend.delivered.length, 0);
		stripe.answer = { invoiceId: INVOICE, attemptCount: 1 };
		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 1);
		assert.equal(await emailedAttempt(subject), "in_1Open/1");
	});

	it("a mark failure after the send: the retry delivers no second email and records the attempt", async () => {
		const { resend, subject } = setUp({
			stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } },
			markFailures: { remaining: 1 },
		});
		await seedDunning(subject);

		assert.equal(await deliver(subject), 1);
		assert.equal(await emailedAttempt(subject), undefined);
		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 1);
		assert.equal(await emailedAttempt(subject), "in_1Open/1");
	});

	it("a deleted row sends nothing and creates no row", async () => {
		const { resend, askedFor, subject } = setUp({
			stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } },
		});

		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 0);
		assert.deepEqual(askedFor, []);
		assert.equal(await subject.providers.findByUserId(USER_ID), undefined);
	});

	it("no email on file sends nothing and records nothing", async () => {
		const { resend, subject } = setUp({
			stripe: { answer: { invoiceId: INVOICE, attemptCount: 1 } },
			findEmail: async () => null,
		});
		await seedDunning(subject);

		assert.equal(await deliver(subject), 0);

		assert.equal(resend.delivered.length, 0);
		assert.equal(await emailedAttempt(subject), undefined);
	});
});

describe("lifecycle_email_sent", () => {
	const CHARGE_AT = "2026-06-06T00:00:00.000Z";
	const TRIAL_ENDS_TWO_DAYS_AFTER_SEND = "2026-06-06T10:00:00.000Z";
	const baseEvent = {
		stream: "analytics",
		event: "lifecycle_email_sent",
		timestamp: SENT_AT.toISOString(),
		user_id: USER_ID,
		delivery: "automated",
	};

	function deliver(subject: ReturnType<typeof buildSubject>, body: string) {
		return subject.handler(
			buildSqsEvent([{ messageId: "msg-lifecycle", body }]),
			buildLambdaContext(),
			() => {},
		);
	}

	async function seedActiveSubscriber(subject: ReturnType<typeof buildSubject>): Promise<void> {
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_lifecycle",
			customerId: "cus_lifecycle",
		});
	}

	it("records trial-reminder with the trial day of the row's trialEndsAt", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TWO_DAYS_AFTER_SEND });

		await deliver(subject, buildReminderBody(USER_ID));

		assert.deepEqual(subject.lifecycleEvents, [
			{ ...baseEvent, kind: "trial-reminder", trial_day: 13, utm_source: "trial-reminder" },
		]);
	});

	it("records charge-reminder with the trial day of the command's chargeAt, as an active row has no trialEndsAt", async () => {
		const subject = buildSubject();
		await seedActiveSubscriber(subject);

		await deliver(subject, buildChargeReminderBody(USER_ID, CHARGE_AT));

		const row = await subject.providers.findByUserId(USER_ID);
		assert.equal(row?.trialEndsAt, undefined);
		assert.deepEqual(subject.lifecycleEvents, [
			{ ...baseEvent, kind: "charge-reminder", trial_day: 13, utm_source: "charge-reminder" },
		]);
	});

	it("holds back the feedback email and its event for a reader the founder has written to", async () => {
		const subject = buildSubject({ articlesTotal: 3 });
		await seedCancelledTrial(subject.providers);
		await subject.providers.recordFounderNote({ userId: USER_ID, sentAt: "2026-05-23T00:00:00.000Z" });

		const result = await deliver(subject, buildEventBridgeBody(USER_ID));

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(subject.email.getSentEmails(), []);
		assert.deepEqual(subject.lifecycleEvents, []);
		const row = await subject.providers.findByUserId(USER_ID);
		assert.equal(row?.trialFeedbackEmailSentAt, undefined);
	});

	it("records trial-feedback with no trial day and no utm source, as a cancelled row has no trialEndsAt and the email no tagged link", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);

		await deliver(subject, buildEventBridgeBody(USER_ID));

		assert.deepEqual(subject.lifecycleEvents, [
			{ ...baseEvent, kind: "trial-feedback", trial_day: null, utm_source: null },
		]);
	});

	it("records nothing for payment_failed, which is not a trial email", async () => {
		const subject = buildSubject();
		await seedActiveSubscriber(subject);

		await deliver(subject, buildPaymentFailedBody(USER_ID));

		assert.equal(subject.email.getSentEmails().length, 1);
		assert.deepEqual(subject.lifecycleEvents, []);
	});

	it("records nothing for automation_saves_held, which is not a trial email", async () => {
		const subject = buildSubject();
		await seedCancelledTrial(subject.providers);

		await deliver(subject, buildAutomationSavesHeldBody(USER_ID));

		assert.equal(subject.email.getSentEmails().length, 1);
		assert.deepEqual(subject.lifecycleEvents, []);
	});

	it.each([
		{
			kind: "trial-reminder",
			body: buildReminderBody(USER_ID),
			seed: async (subject: ReturnType<typeof buildSubject>) => {
				await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TWO_DAYS_AFTER_SEND });
			},
		},
		{
			kind: "charge-reminder",
			body: buildChargeReminderBody(USER_ID, CHARGE_AT),
			seed: seedActiveSubscriber,
		},
		{
			kind: "trial-feedback",
			body: buildEventBridgeBody(USER_ID),
			seed: (subject: ReturnType<typeof buildSubject>) => seedCancelledTrial(subject.providers),
		},
	])("records nothing for $kind when sendEmail throws", async ({ body, seed }) => {
		const subject = buildSubject({
			sendEmail: async () => {
				throw new Error("Resend rejected");
			},
		});
		await seed(subject);

		const result = await deliver(subject, body);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.deepEqual(subject.lifecycleEvents, []);
	});
});

describe("trial nudge dispatch", () => {
	for (const kind of ["trial_day3", "trial_day7"]) {
		it(`routes ${kind} to its own sender`, async () => {
			const info = jest.fn();
			const subject = buildSubject({ logger: Logger.from({ ...noopLogger, info }) });

			await subject.handler(
				buildSqsEvent([{ messageId: "msg-nudge", body: JSON.stringify({ detail: { userId: USER_ID, kind } }) }]),
				buildLambdaContext(),
				() => {},
			);

			assert.ok(info.mock.calls.some(([message]) => message === `[send-trial-feedback-email] ${kind} noop`));
			assert.deepEqual(subject.email.getSentEmails(), []);
		});
	}
});
