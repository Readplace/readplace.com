import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { FindArticlesByUser } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
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

function fakeFindArticlesByUser(total: number): FindArticlesByUser {
	return async () => ({
		articles: [],
		total,
		page: 1,
		pageSize: 20,
	});
}

interface SubjectOverrides {
	findEmail?: (userId: string) => Promise<string | null>;
	articlesTotal?: number;
}

function buildSubject(overrides: SubjectOverrides = {}) {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-01T00:00:00.000Z"),
	});
	const email = initInMemoryEmail();
	const findEmailByUserId = overrides.findEmail ?? (async () => "user@example.com");
	const deps: SendTrialFeedbackEmailDeps = {
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId,
		findArticlesByUser: fakeFindArticlesByUser(overrides.articlesTotal ?? 0),
		markTrialFeedbackEmailSent: providers.markTrialFeedbackEmailSent,
		sendEmail: email.sendEmail,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		now: () => SENT_AT,
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

describe("send-trial-feedback-email handler", () => {
	it("sends the email and marks the row as sent on the happy path", async () => {
		const subject = buildSubject({ articlesTotal: 9 });
		await seedCancelledTrial(subject.providers);

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-ok", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
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
			{} as never,
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
			{} as never,
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
			{} as never,
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
			{} as never,
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
			{} as never,
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
			{} as never,
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
			{} as never,
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
			sendEmail: async () => {
				throw new Error("Resend rejected");
			},
			founderAvatarUrl: FOUNDER_AVATAR_URL,
			now: () => SENT_AT,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-fail", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
		const row = await providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.trialFeedbackEmailSentAt, undefined);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "not-json" }]),
			{} as never,
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
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});
});
