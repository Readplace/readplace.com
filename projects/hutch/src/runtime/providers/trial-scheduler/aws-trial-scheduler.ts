import assert from "node:assert";
import {
	CreateScheduleCommand,
	DeleteScheduleCommand,
	type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import type { UserId } from "@packages/domain/user";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";

/** EventBridge Scheduler's `at(<iso>)` does not accept fractional seconds or a
 * trailing Z. Strip both before composing the expression. */
function toNaiveSeconds(iso: string): string {
	return iso.replace(/Z$/, "").replace(/\.\d+$/, "");
}

/** Deterministic schedule name keyed by userId. UserIds are 32-char hex (branded
 * `UserId`), so the full name stays inside EventBridge Scheduler's 64-char limit. */
function trialEndScheduleName(userId: UserId): string {
	return `trial-end-${userId}`;
}

/** Distinct name so the trial-end and deferred-cancellation schedules for the
 * same user can coexist (the trial-cancel branch deletes the trial-end one
 * and creates this one in the same transaction). */
function deferredCancellationScheduleName(userId: UserId): string {
	return `cancel-${userId}`;
}

/** Deterministic name keyed by userId. Duplicate SubscriptionCancelledEvent
 * deliveries (at-least-once + dual-publisher: cancel-subscription and
 * stripe-webhook-receiver) overwrite the same schedule instead of stacking. */
function trialFeedbackEmailScheduleName(userId: UserId): string {
	return `trial-feedback-${userId}`;
}

export function initAwsTrialScheduler(deps: {
	client: Pick<SchedulerClient, "send">;
	scheduleGroupName: string;
	schedulerRoleArn?: string;
	eventBusArn?: string;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
} {
	const createTrialEndSchedule: CreateTrialEndSchedule = async ({ userId, firesAt }) => {
		assert(deps.eventBusArn, "eventBusArn is required for createTrialEndSchedule");
		assert(deps.schedulerRoleArn, "schedulerRoleArn is required for createTrialEndSchedule");
		await deps.client.send(
			new CreateScheduleCommand({
				Name: trialEndScheduleName(userId),
				GroupName: deps.scheduleGroupName,
				ScheduleExpression: `at(${toNaiveSeconds(firesAt)})`,
				FlexibleTimeWindow: { Mode: "OFF" },
				ActionAfterCompletion: "DELETE",
				State: "ENABLED",
				Target: {
					Arn: deps.eventBusArn,
					RoleArn: deps.schedulerRoleArn,
					EventBridgeParameters: {
						Source: "hutch.subscriptions",
						DetailType: "SubscriptionStartRequestCommand",
					},
					Input: JSON.stringify({ userId }),
				},
			}),
		);
	};

	const deleteTrialEndSchedule: DeleteTrialEndSchedule = async ({ userId }) => {
		try {
			await deps.client.send(
				new DeleteScheduleCommand({
					Name: trialEndScheduleName(userId),
					GroupName: deps.scheduleGroupName,
				}),
			);
		} catch (err) {
			if (err instanceof Error && err.name === "ResourceNotFoundException") {
				return;
			}
			throw err;
		}
	};

	const createDeferredCancellationSchedule: CreateDeferredCancellationSchedule = async ({
		userId,
		firesAt,
	}) => {
		assert(deps.eventBusArn, "eventBusArn is required for createDeferredCancellationSchedule");
		assert(
			deps.schedulerRoleArn,
			"schedulerRoleArn is required for createDeferredCancellationSchedule",
		);
		await deps.client.send(
			new CreateScheduleCommand({
				Name: deferredCancellationScheduleName(userId),
				GroupName: deps.scheduleGroupName,
				ScheduleExpression: `at(${toNaiveSeconds(firesAt)})`,
				FlexibleTimeWindow: { Mode: "OFF" },
				ActionAfterCompletion: "DELETE",
				State: "ENABLED",
				Target: {
					Arn: deps.eventBusArn,
					RoleArn: deps.schedulerRoleArn,
					EventBridgeParameters: {
						Source: "hutch.subscriptions",
						DetailType: "CancelSubscriptionCommand",
					},
					Input: JSON.stringify({ userId }),
				},
			}),
		);
	};

	const deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule = async ({
		userId,
	}) => {
		try {
			await deps.client.send(
				new DeleteScheduleCommand({
					Name: deferredCancellationScheduleName(userId),
					GroupName: deps.scheduleGroupName,
				}),
			);
		} catch (err) {
			if (err instanceof Error && err.name === "ResourceNotFoundException") {
				return;
			}
			throw err;
		}
	};

	const createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule = async ({
		userId,
		firesAt,
	}) => {
		assert(
			deps.eventBusArn,
			"eventBusArn is required for createTrialFeedbackEmailSchedule",
		);
		assert(
			deps.schedulerRoleArn,
			"schedulerRoleArn is required for createTrialFeedbackEmailSchedule",
		);
		await deps.client.send(
			new CreateScheduleCommand({
				Name: trialFeedbackEmailScheduleName(userId),
				GroupName: deps.scheduleGroupName,
				ScheduleExpression: `at(${toNaiveSeconds(firesAt)})`,
				FlexibleTimeWindow: { Mode: "OFF" },
				ActionAfterCompletion: "DELETE",
				State: "ENABLED",
				Target: {
					Arn: deps.eventBusArn,
					RoleArn: deps.schedulerRoleArn,
					EventBridgeParameters: {
						Source: "hutch.subscriptions",
						DetailType: "SendTrialFeedbackEmailCommand",
					},
					Input: JSON.stringify({ userId }),
				},
			}),
		);
	};

	const deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule = async ({
		userId,
	}) => {
		try {
			await deps.client.send(
				new DeleteScheduleCommand({
					Name: trialFeedbackEmailScheduleName(userId),
					GroupName: deps.scheduleGroupName,
				}),
			);
		} catch (err) {
			if (err instanceof Error && err.name === "ResourceNotFoundException") {
				return;
			}
			throw err;
		}
	};

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		createDeferredCancellationSchedule,
		deleteDeferredCancellationSchedule,
		createTrialFeedbackEmailSchedule,
		deleteTrialFeedbackEmailSchedule,
	};
}
