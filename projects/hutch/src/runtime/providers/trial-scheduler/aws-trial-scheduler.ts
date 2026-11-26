import {
	CreateScheduleCommand,
	DeleteScheduleCommand,
	type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import type { UserId } from "@packages/domain/user";
import { AgeLockDeletionDueCommand } from "@packages/infra-components";
import type {
	CreateAgeLockDeletionSchedule,
	CreateChargeReminderSchedule,
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	CreateTrialNudgeSchedule,
	CreateTrialReminderSchedule,
	DeleteAgeLockDeletionSchedule,
	DeleteChargeReminderSchedule,
	DeleteTrialNudgeSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
	TrialNudgeKind,
} from "@packages/provider-contracts/trial-scheduler";

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

/** Deterministic name keyed by userId, so duplicate SubscriptionCancelledEvent
 * deliveries (at-least-once + dual-publisher: cancel-subscription and
 * stripe-webhook-receiver) target one schedule instead of stacking. The name
 * alone does not make a re-delivery safe — CreateSchedule REJECTS a name that
 * already exists — so callers must delete before they create. */
function trialFeedbackEmailScheduleName(userId: UserId): string {
	return `trial-feedback-${userId}`;
}

/** Deterministic name keyed by userId, distinct from the feedback schedule so
 * the pre-expiry reminder and post-cancellation feedback one-shots can coexist
 * for the same user. Both target the same DetailType; `Input.kind` disambiguates. */
function trialReminderScheduleName(userId: UserId): string {
	return `trial-reminder-${userId}`;
}

const TRIAL_NUDGE_SCHEDULE_PREFIXES = {
	trial_day3: "trial-day3",
	trial_day7: "trial-day7",
} satisfies Record<TrialNudgeKind, string>;

function trialNudgeScheduleName(input: { userId: UserId; kind: TrialNudgeKind }): string {
	return `${TRIAL_NUDGE_SCHEDULE_PREFIXES[input.kind]}-${input.userId}`;
}

function chargeReminderScheduleName(userId: UserId): string {
	return `charge-reminder-${userId}`;
}

function ageLockDeletionScheduleName(userId: UserId): string {
	return `age-lock-delete-${userId}`;
}

export function initAwsTrialScheduler(deps: {
	client: Pick<SchedulerClient, "send">;
	scheduleGroupName: string;
	schedulerRoleArn: string;
	eventBusArn: string;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	createTrialReminderSchedule: CreateTrialReminderSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	createTrialNudgeSchedule: CreateTrialNudgeSchedule;
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	deleteChargeReminderSchedule: DeleteChargeReminderSchedule;
	deleteTrialNudgeSchedule: DeleteTrialNudgeSchedule;
	createAgeLockDeletionSchedule: CreateAgeLockDeletionSchedule;
	deleteAgeLockDeletionSchedule: DeleteAgeLockDeletionSchedule;
} {
	const createOneShot = async (schedule: {
		name: string;
		firesAt: string;
		source: string;
		detailType: string;
		input: Record<string, unknown>;
	}): Promise<void> => {
		await deps.client.send(
			new CreateScheduleCommand({
				Name: schedule.name,
				GroupName: deps.scheduleGroupName,
				ScheduleExpression: `at(${toNaiveSeconds(schedule.firesAt)})`,
				FlexibleTimeWindow: { Mode: "OFF" },
				ActionAfterCompletion: "DELETE",
				State: "ENABLED",
				Target: {
					Arn: deps.eventBusArn,
					RoleArn: deps.schedulerRoleArn,
					EventBridgeParameters: { Source: schedule.source, DetailType: schedule.detailType },
					Input: JSON.stringify(schedule.input),
				},
			}),
		);
	};

	const deleteIfExists = async (name: string): Promise<void> => {
		try {
			await deps.client.send(new DeleteScheduleCommand({ Name: name, GroupName: deps.scheduleGroupName }));
		} catch (err) {
			if (err instanceof Error && err.name === "ResourceNotFoundException") {
				return;
			}
			throw err;
		}
	};

	const createTrialEndSchedule: CreateTrialEndSchedule = ({ userId, firesAt }) =>
		createOneShot({
			name: trialEndScheduleName(userId),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "SubscriptionStartRequestCommand",
			input: { userId },
		});

	const deleteTrialEndSchedule: DeleteTrialEndSchedule = ({ userId }) =>
		deleteIfExists(trialEndScheduleName(userId));

	const createDeferredCancellationSchedule: CreateDeferredCancellationSchedule = ({ userId, firesAt, reason }) =>
		createOneShot({
			name: deferredCancellationScheduleName(userId),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "CancelSubscriptionCommand",
			input: reason ? { userId, reason } : { userId },
		});

	const deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule = ({ userId }) =>
		deleteIfExists(deferredCancellationScheduleName(userId));

	const createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule = ({ userId, firesAt }) =>
		createOneShot({
			name: trialFeedbackEmailScheduleName(userId),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "SendTrialFeedbackEmailCommand",
			input: { userId },
		});

	const deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule = ({ userId }) =>
		deleteIfExists(trialFeedbackEmailScheduleName(userId));

	const createTrialReminderSchedule: CreateTrialReminderSchedule = ({ userId, firesAt }) =>
		createOneShot({
			name: trialReminderScheduleName(userId),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "SendTrialFeedbackEmailCommand",
			input: { userId, kind: "reminder" },
		});

	const deleteTrialReminderSchedule: DeleteTrialReminderSchedule = ({ userId }) =>
		deleteIfExists(trialReminderScheduleName(userId));

	const createTrialNudgeSchedule: CreateTrialNudgeSchedule = ({ userId, kind, firesAt }) =>
		createOneShot({
			name: trialNudgeScheduleName({ userId, kind }),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "SendTrialFeedbackEmailCommand",
			input: { userId, kind },
		});

	const createChargeReminderSchedule: CreateChargeReminderSchedule = ({ userId, firesAt, chargeAt }) =>
		createOneShot({
			name: chargeReminderScheduleName(userId),
			firesAt,
			source: "hutch.subscriptions",
			detailType: "SendTrialFeedbackEmailCommand",
			input: { userId, kind: "charge_reminder", chargeAt },
		});

	const deleteChargeReminderSchedule: DeleteChargeReminderSchedule = ({ userId }) =>
		deleteIfExists(chargeReminderScheduleName(userId));

	const deleteTrialNudgeSchedule: DeleteTrialNudgeSchedule = ({ userId, kind }) =>
		deleteIfExists(trialNudgeScheduleName({ userId, kind }));

	const createAgeLockDeletionSchedule: CreateAgeLockDeletionSchedule = ({ userId, firesAt }) =>
		createOneShot({
			name: ageLockDeletionScheduleName(userId),
			firesAt,
			source: AgeLockDeletionDueCommand.source,
			detailType: AgeLockDeletionDueCommand.detailType,
			input: { userId },
		});

	const deleteAgeLockDeletionSchedule: DeleteAgeLockDeletionSchedule = ({ userId }) =>
		deleteIfExists(ageLockDeletionScheduleName(userId));

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		createDeferredCancellationSchedule,
		deleteDeferredCancellationSchedule,
		createTrialFeedbackEmailSchedule,
		deleteTrialFeedbackEmailSchedule,
		createTrialReminderSchedule,
		deleteTrialReminderSchedule,
		createTrialNudgeSchedule,
		createChargeReminderSchedule,
		deleteChargeReminderSchedule,
		deleteTrialNudgeSchedule,
		createAgeLockDeletionSchedule,
		deleteAgeLockDeletionSchedule,
	};
}
