import assert from "node:assert";
import {
	CreateScheduleCommand,
	DeleteScheduleCommand,
	type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import type { UserId } from "@packages/domain/user";
import type {
	CreateTrialEndSchedule,
	DeleteTrialEndSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";

/** EventBridge Scheduler's `at(<iso>)` does not accept fractional seconds or a
 * trailing Z. Strip both before composing the expression. */
function toNaiveSeconds(iso: string): string {
	return iso.replace(/Z$/, "").replace(/\.\d+$/, "");
}

/** Deterministic schedule name keyed by userId. UserIds are 32-char hex (branded
 * `UserId`), so the full name stays inside EventBridge Scheduler's 64-char limit. */
function scheduleNameFor(userId: UserId): string {
	return `trial-end-${userId}`;
}

export function initAwsTrialScheduler(deps: {
	client: Pick<SchedulerClient, "send">;
	scheduleGroupName: string;
	schedulerRoleArn?: string;
	eventBusArn?: string;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
} {
	const createTrialEndSchedule: CreateTrialEndSchedule = async ({ userId, firesAt }) => {
		assert(deps.eventBusArn, "eventBusArn is required for createTrialEndSchedule");
		assert(deps.schedulerRoleArn, "schedulerRoleArn is required for createTrialEndSchedule");
		await deps.client.send(
			new CreateScheduleCommand({
				Name: scheduleNameFor(userId),
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
					Name: scheduleNameFor(userId),
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

	return { createTrialEndSchedule, deleteTrialEndSchedule };
}
