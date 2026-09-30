import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { EffectiveAccess } from "@packages/subscription-access";
import { QUEUE_DIGEST_EVENTS, STREAMS } from "./events";

export type QueueDigestSkipReason =
	| "no-verified-email"
	| "unsubscribed"
	| "no-eligible-items"
	| "pay-no-ready-saves";

type QueueDigestRecipientTier = "trial" | "paid";

interface QueueDigestEventBase {
	stream: typeof STREAMS.analytics;
	timestamp: string;
	user_id: UserId;
}

type QueueDigestSentKindFields = { kind: "regular" } | { kind: "pay"; hours_to_trial_end: number };

export type QueueDigestLogEvent =
	| (QueueDigestEventBase &
			QueueDigestSentKindFields & {
				event: typeof QUEUE_DIGEST_EVENTS.sent;
				send_id: string;
				item_count: number;
				previously_emailed_count: number;
				tier: QueueDigestRecipientTier;
				trial_day: number | null;
			})
	| (QueueDigestEventBase & {
			event: typeof QUEUE_DIGEST_EVENTS.skipped;
			tier: EffectiveAccess["tier"];
			reason: QueueDigestSkipReason;
		});

export type QueueDigestSentKind = { kind: "regular" } | { kind: "pay"; hoursToTrialEnd: number };

export type QueueDigestSent = QueueDigestSentKind & {
	userId: UserId;
	sendId: string;
	itemCount: number;
	previouslyEmailedCount: number;
	tier: QueueDigestRecipientTier;
	trialDay: number | null;
};

export interface EmitQueueDigestEvent {
	sent: (params: QueueDigestSent) => void;
	skipped: (params: { userId: UserId; tier: EffectiveAccess["tier"]; reason: QueueDigestSkipReason }) => void;
}

function sentKindFields(params: QueueDigestSentKind): QueueDigestSentKindFields {
	return params.kind === "pay"
		? { kind: "pay", hours_to_trial_end: params.hoursToTrialEnd }
		: { kind: "regular" };
}

export function initEmitQueueDigestEvent(deps: {
	logger: HutchLogger.Typed<QueueDigestLogEvent>;
	now: () => Date;
}): EmitQueueDigestEvent {
	return {
		sent: (params) => {
			deps.logger.info({
				stream: STREAMS.analytics,
				event: QUEUE_DIGEST_EVENTS.sent,
				timestamp: deps.now().toISOString(),
				user_id: params.userId,
				send_id: params.sendId,
				...sentKindFields(params),
				item_count: params.itemCount,
				previously_emailed_count: params.previouslyEmailedCount,
				tier: params.tier,
				trial_day: params.trialDay,
			});
		},
		skipped: ({ userId, tier, reason }) => {
			deps.logger.info({
				stream: STREAMS.analytics,
				event: QUEUE_DIGEST_EVENTS.skipped,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				tier,
				reason,
			});
		},
	};
}
