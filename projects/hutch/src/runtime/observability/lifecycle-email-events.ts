import type { UserId } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import { LIFECYCLE_EMAIL_EVENTS, STREAMS } from "./events";

export const LIFECYCLE_EMAIL_KINDS = [
	"welcome",
	"welcome-chatgpt",
	"welcome-claude",
	"trial-day3",
	"trial-day7",
	"trial-reminder",
	"charge-reminder",
	"trial-feedback",
	"founder-note-day1",
	"founder-note-day12",
] as const;

type LifecycleEmailKind = (typeof LIFECYCLE_EMAIL_KINDS)[number];

type LifecycleEmailDelivery = "automated" | "founder-manual";

export type LifecycleEmailSentEvent = {
	stream: typeof STREAMS.analytics;
	event: typeof LIFECYCLE_EMAIL_EVENTS.sent;
	timestamp: string;
	user_id: UserId;
	kind: LifecycleEmailKind;
	trial_day: number | null;
	utm_source: string | null;
	delivery: LifecycleEmailDelivery;
};

export type EmitLifecycleEmailSent = (params: {
	userId: UserId;
	kind: LifecycleEmailKind;
	trialDay: number | null;
	utmSource: string | null;
	delivery: LifecycleEmailDelivery;
}) => void;

export function initEmitLifecycleEmailSent(deps: {
	logger: Logger.Typed<LifecycleEmailSentEvent>;
	now: () => Date;
}): EmitLifecycleEmailSent {
	return (params) => {
		deps.logger.info({
			stream: STREAMS.analytics,
			event: LIFECYCLE_EMAIL_EVENTS.sent,
			timestamp: deps.now().toISOString(),
			user_id: params.userId,
			kind: params.kind,
			trial_day: params.trialDay,
			utm_source: params.utmSource,
			delivery: params.delivery,
		});
	};
}
