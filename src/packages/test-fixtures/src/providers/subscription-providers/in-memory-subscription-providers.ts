import assert from "node:assert";
import { type EventInstant, toEventInstant } from "@packages/domain/event-envelope";
import type { UserId } from "@packages/domain/user";
import { ConditionalCheckFailedException } from "@packages/storage-client";
import {
	type ClaimPayDigest,
	type ClaimTrialNudge,
	type ReleaseTrialNudge,
	type DeleteSubscription,
	type FindSubscriptionBySubscriptionId,
	type FindSubscriptionByUserId,
	type ListUserIdsBySubscriptionStatus,
	type MarkSubscriptionActive,
	type MarkSubscriptionCancelledByEvent,
	type MarkSubscriptionCancelledByUserId,
	type MarkSubscriptionPendingCancellation,
	type MarkSubscriptionPendingCancellationByEvent,
	type MarkTrialFeedbackEmailSent,
	type MarkTrialReminderEmailSent,
	type MarkAutomationSavesHeldEmailSent,
	type MarkPaymentFailedEmailSent,
	type RecordFounderNote,
	type ReleasePayDigest,
	type SetSubscriptionNextCharge,
	type SubscriptionRecord,
	TRIAL_NUDGE_MARKERS,
	type UpsertActiveSubscription,
	type UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";

const MARKERS_KEPT_ACROSS_TRIAL_WINDOWS: ReadonlySet<string> = new Set<keyof SubscriptionRecord>([
	"trialDay3EmailSentAt",
	"trialDay3EmailMessageId",
	"trialDay7EmailSentAt",
	"trialDay7EmailMessageId",
	"founderNoteSentAt",
]);

function markersKeptAcrossTrialWindows(existing: SubscriptionRecord | undefined): Partial<SubscriptionRecord> {
	return Object.fromEntries(
		Object.entries(existing ?? {}).filter(([key]) => MARKERS_KEPT_ACROSS_TRIAL_WINDOWS.has(key)),
	);
}

export function initInMemorySubscriptionProviders(opts: {
	now: () => Date;
}): {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	listUserIdsByStatus: ListUserIdsBySubscriptionStatus;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markPendingCancellationByEvent: MarkSubscriptionPendingCancellationByEvent;
	markCancelledByEvent: MarkSubscriptionCancelledByEvent;
	markActive: MarkSubscriptionActive;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent;
	markPaymentFailedEmailSent: MarkPaymentFailedEmailSent;
	claimPayDigest: ClaimPayDigest;
	releasePayDigest: ReleasePayDigest;
	claimTrialNudge: ClaimTrialNudge;
	releaseTrialNudge: ReleaseTrialNudge;
	recordFounderNote: RecordFounderNote;
	setNextCharge: SetSubscriptionNextCharge;
	deleteSubscription: DeleteSubscription;
	seedRow: (row: SubscriptionRecord) => void;
} {
	const rows = new Map<UserId, SubscriptionRecord>();

	const findByUserId: FindSubscriptionByUserId = async (userId) => rows.get(userId);

	const findBySubscriptionId: FindSubscriptionBySubscriptionId = async (subscriptionId) => {
		for (const row of rows.values()) {
			if (row.subscriptionId === subscriptionId) return row;
		}
		return undefined;
	};

	const listUserIdsByStatus: ListUserIdsBySubscriptionStatus = async (status) =>
		[...rows.values()].filter((row) => row.status === status).map((row) => row.userId);

	const upsertTrialing: UpsertTrialingSubscription = async ({ userId, trialEndsAt }) => {
		const existing = rows.get(userId);
		const nowIso = opts.now().toISOString();
		rows.set(userId, {
			...markersKeptAcrossTrialWindows(existing),
			userId,
			provider: "stripe",
			status: "trialing",
			trialEndsAt,
			statusEnteredAt: toEventInstant(opts.now()),
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		});
	};

	const upsertActive: UpsertActiveSubscription = async ({
		userId,
		subscriptionId,
		customerId,
		plan,
	}) => {
		const existing = rows.get(userId);
		const nowIso = opts.now().toISOString();
		rows.set(userId, {
			...markersKeptAcrossTrialWindows(existing),
			userId,
			provider: "stripe",
			subscriptionId,
			customerId,
			status: "active",
			...(plan === undefined ? {} : { plan }),
			statusEnteredAt: toEventInstant(opts.now()),
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		});
	};

	const writePendingCancellation = (existing: SubscriptionRecord, cancellationEffectiveAt: string): void => {
		const { nextCharge: _nc, ...rest } = existing;
		rows.set(existing.userId, {
			...rest,
			status: "pending_cancellation",
			cancellationEffectiveAt,
			statusEnteredAt: toEventInstant(opts.now()),
			updatedAt: opts.now().toISOString(),
		});
	};

	const writeCancelled = (existing: SubscriptionRecord): void => {
		const { trialEndsAt: _t, cancellationEffectiveAt: _ca, nextCharge: _nc, ...rest } = existing;
		rows.set(existing.userId, {
			...rest,
			status: "cancelled",
			statusEnteredAt: toEventInstant(opts.now()),
			updatedAt: opts.now().toISOString(),
		});
	};

	const rowAcceptingEvent = (params: { userId: UserId; eventTime: EventInstant }): SubscriptionRecord => {
		const existing = rows.get(params.userId);
		const newer = existing?.statusEnteredAt !== undefined && existing.statusEnteredAt > params.eventTime;
		if (existing === undefined || newer) {
			throw new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
		}
		return existing;
	};

	const markPendingCancellation: MarkSubscriptionPendingCancellation = async ({ userId, cancellationEffectiveAt }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		writePendingCancellation(existing, cancellationEffectiveAt);
	};

	const markCancelledByUserId: MarkSubscriptionCancelledByUserId = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		writeCancelled(existing);
	};

	const markPendingCancellationByEvent: MarkSubscriptionPendingCancellationByEvent = async ({
		userId,
		cancellationEffectiveAt,
		eventTime,
	}) => {
		writePendingCancellation(rowAcceptingEvent({ userId, eventTime }), cancellationEffectiveAt);
	};

	const markCancelledByEvent: MarkSubscriptionCancelledByEvent = async ({ userId, eventTime }) => {
		writeCancelled(rowAcceptingEvent({ userId, eventTime }));
	};

	const markActive: MarkSubscriptionActive = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const {
			cancellationEffectiveAt: _ca,
			automationSavesHeldEmailSentAt: _ah,
			...rest
		} = existing;
		rows.set(userId, {
			...rest,
			status: "active",
			statusEnteredAt: toEventInstant(opts.now()),
			updatedAt: opts.now().toISOString(),
		});
	};

	const markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent = async ({
		userId,
		sentAt,
	}) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			trialFeedbackEmailSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markTrialReminderEmailSent: MarkTrialReminderEmailSent = async ({
		userId,
		sentAt,
	}) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			trialReminderEmailSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markPaymentFailedEmailSent: MarkPaymentFailedEmailSent = async ({ userId, attempt }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			paymentFailedEmailAttempt: attempt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent = async ({
		userId,
		sentAt,
	}) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		if (existing.automationSavesHeldEmailSentAt !== undefined) return "already-sent";
		rows.set(userId, {
			...existing,
			automationSavesHeldEmailSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
		return "claimed";
	};

	const claimPayDigest: ClaimPayDigest = async ({ userId, trialEndsAt, messageId, now, urls }) => {
		const existing = rows.get(userId);
		if (
			existing?.status === "trialing" &&
			existing.trialEndsAt === trialEndsAt &&
			existing.payDigestEmailSentAt === undefined
		) {
			const nowIso = now.toISOString();
			rows.set(userId, {
				...existing,
				payDigestEmailSentAt: nowIso,
				payDigestMessageId: messageId,
				payDigestUrls: urls,
				updatedAt: nowIso,
			});
			return { claimed: true, redelivery: false };
		}
		if (existing?.payDigestMessageId !== messageId) return { claimed: false };
		assert(existing.payDigestEmailSentAt, "a stored pay-digest claim carries its instant");
		assert(existing.payDigestUrls, "a stored pay-digest claim carries the urls it listed");
		return {
			claimed: true,
			redelivery: true,
			claimedAt: new Date(existing.payDigestEmailSentAt),
			urls: existing.payDigestUrls,
		};
	};

	const releasePayDigest: ReleasePayDigest = async ({ userId, claimedAt, messageId }) => {
		const existing = rows.get(userId);
		if (
			existing?.payDigestEmailSentAt !== claimedAt.toISOString() ||
			existing.payDigestMessageId !== messageId
		) {
			return;
		}
		const {
			payDigestEmailSentAt: _sentAt,
			payDigestMessageId: _messageId,
			payDigestUrls: _urls,
			...rest
		} = existing;
		rows.set(userId, rest);
	};

	const claimTrialNudge: ClaimTrialNudge = async ({ userId, kind, messageId, now }) => {
		const marker = TRIAL_NUDGE_MARKERS[kind];
		const existing = rows.get(userId);
		if (existing?.status === "trialing" && existing[marker.sentAt] === undefined) {
			const nowIso = now.toISOString();
			rows.set(userId, {
				...existing,
				[marker.sentAt]: nowIso,
				[marker.messageId]: messageId,
				updatedAt: nowIso,
			});
			return { claimed: true };
		}
		if (existing?.[marker.messageId] !== messageId) return { claimed: false };
		return { claimed: true };
	};

	const releaseTrialNudge: ReleaseTrialNudge = async ({ userId, kind, messageId }) => {
		const marker = TRIAL_NUDGE_MARKERS[kind];
		const existing = rows.get(userId);
		if (!existing || existing[marker.messageId] !== messageId) return;
		const { [marker.sentAt]: _sentAt, [marker.messageId]: _messageId, ...rest } = existing;
		rows.set(userId, rest);
	};

	const recordFounderNote: RecordFounderNote = async ({ userId, sentAt }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			founderNoteSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	/* Mirrors the condition the real table enforces — the row must still exist, still
	 * be active, and still hold the subscription the charge was read from. Accepting
	 * writes the production store would reject would let tests pass against a world
	 * that cannot happen. */
	const setNextCharge: SetSubscriptionNextCharge = async ({
		userId,
		subscriptionId,
		nextCharge,
	}) => {
		const existing = rows.get(userId);
		assert(
			existing?.status === "active" && existing.subscriptionId === subscriptionId,
			`No active subscription ${subscriptionId} for user ${userId}`,
		);
		rows.set(userId, {
			...existing,
			nextCharge,
			updatedAt: opts.now().toISOString(),
		});
	};

	const deleteSubscription: DeleteSubscription = async ({ userId }) => {
		rows.delete(userId);
	};

	/** Test-only escape hatch for seeding hypothetical row shapes (e.g. a
	 * trialing row that also has a customerId — production paths never write
	 * this combination, but the trial-end charge handler must still cover the
	 * defensive case). DO NOT use in production code. */
	const seedRow = (row: SubscriptionRecord): void => {
		rows.set(row.userId, row);
	};

	return {
		findByUserId,
		findBySubscriptionId,
		listUserIdsByStatus,
		upsertTrialing,
		upsertActive,
		markPendingCancellation,
		markCancelledByUserId,
		markPendingCancellationByEvent,
		markCancelledByEvent,
		markActive,
		markTrialFeedbackEmailSent,
		markTrialReminderEmailSent,
		markAutomationSavesHeldEmailSent,
		markPaymentFailedEmailSent,
		claimPayDigest,
		releasePayDigest,
		claimTrialNudge,
		releaseTrialNudge,
		recordFounderNote,
		setNextCharge,
		deleteSubscription,
		seedRow,
	};
}
