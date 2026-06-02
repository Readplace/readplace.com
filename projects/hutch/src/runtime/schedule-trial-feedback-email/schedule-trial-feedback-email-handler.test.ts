import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import {
	initScheduleTrialFeedbackEmailHandler,
	TRIAL_FEEDBACK_EMAIL_DELAY_MS,
} from "./schedule-trial-feedback-email-handler";

const USER_ID = UserIdSchema.parse("5".repeat(32));
const NOW = new Date("2026-06-01T00:00:00.000Z");
const EXPECTED_FIRES_AT = new Date(
	NOW.getTime() + TRIAL_FEEDBACK_EMAIL_DELAY_MS,
).toISOString();

function buildEventBridgeBody(detail: {
	userId: string;
	subscriptionId?: string;
	reason?:
		| "stripe_webhook"
		| "user_initiated_trial"
		| "user_initiated_paid_confirmed";
}): string {
	return JSON.stringify({
		detail: {
			userId: detail.userId,
			...(detail.subscriptionId !== undefined
				? { subscriptionId: detail.subscriptionId }
				: {}),
			reason: detail.reason ?? "user_initiated_trial",
		},
	});
}

function buildSubject() {
	const trialScheduler = initInMemoryTrialScheduler();
	const handler = initScheduleTrialFeedbackEmailHandler({
		createTrialFeedbackEmailSchedule: trialScheduler.createTrialFeedbackEmailSchedule,
		now: () => NOW,
		logger: HutchLogger.from(noopLogger),
	});
	return { handler, trialScheduler };
}

describe("schedule-trial-feedback-email handler", () => {
	it("schedules the feedback email exactly 3 days after now when reason='user_initiated_trial'", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-trial",
					body: buildEventBridgeBody({
						userId: USER_ID,
						reason: "user_initiated_trial",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(subject.trialScheduler.allTrialFeedbackEmailSchedules(), [
			{ userId: USER_ID, firesAt: EXPECTED_FIRES_AT },
		]);
	});

	it("ignores cancels with reason='user_initiated_paid_confirmed' — paid churn is out of scope", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-paid",
					body: buildEventBridgeBody({
						userId: USER_ID,
						subscriptionId: "sub_paid",
						reason: "user_initiated_paid_confirmed",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(
			subject.trialScheduler.allTrialFeedbackEmailSchedules(),
			[],
		);
	});

	it("ignores Stripe-side cancels (reason='stripe_webhook') because trial users never produce one", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-stripe",
					body: buildEventBridgeBody({
						userId: USER_ID,
						subscriptionId: "sub_stripe",
						reason: "stripe_webhook",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(
			subject.trialScheduler.allTrialFeedbackEmailSchedules(),
			[],
		);
	});

	it("is idempotent for duplicate SubscriptionCancelledEvent deliveries — same deterministic schedule overwritten, not stacked", async () => {
		const subject = buildSubject();

		await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-dup-1",
					body: buildEventBridgeBody({
						userId: USER_ID,
						reason: "user_initiated_trial",
					}),
				},
			]),
			{} as never,
			() => {},
		);
		await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-dup-2",
					body: buildEventBridgeBody({
						userId: USER_ID,
						reason: "user_initiated_trial",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		const schedules = subject.trialScheduler.allTrialFeedbackEmailSchedules();
		assert.equal(schedules.length, 1);
		assert.equal(schedules[0].firesAt, EXPECTED_FIRES_AT);
	});

	it("reports a batch item failure when the scheduler throws", async () => {
		const trialScheduler = initInMemoryTrialScheduler({
			createTrialFeedbackEmailFails: true,
		});
		const handler = initScheduleTrialFeedbackEmailHandler({
			createTrialFeedbackEmailSchedule:
				trialScheduler.createTrialFeedbackEmailSchedule,
			now: () => NOW,
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-fail",
					body: buildEventBridgeBody({
						userId: USER_ID,
						reason: "user_initiated_trial",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
	});

	it("reports a batch item failure for malformed JSON without dropping other records in the batch", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-bad", body: "not-json" },
				{
					messageId: "msg-ok",
					body: buildEventBridgeBody({
						userId: USER_ID,
						reason: "user_initiated_trial",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
		assert.deepEqual(subject.trialScheduler.allTrialFeedbackEmailSchedules(), [
			{ userId: USER_ID, firesAt: EXPECTED_FIRES_AT },
		]);
	});

	it("reports a batch item failure when the envelope is missing userId — the trial-cancel filter pins the schema", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-schema",
					body: JSON.stringify({
						detail: { reason: "user_initiated_trial" },
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-schema");
	});
});
