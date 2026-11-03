import type { OAuthClientId } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";
import { ANALYTICS_EVENTS, STREAMS } from "./events";

export type ActivationThresholdReachedEvent = {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.activationThresholdReached;
	timestamp: string;
	user_id: UserId;
	oauth_client_id: OAuthClientId | null;
	hours_since_signup: number;
};

export function buildActivationThresholdReachedEvent(
	deps: { now: () => Date },
	params: { userId: UserId; registeredAt: string; signupOAuthClientId: OAuthClientId | null },
): ActivationThresholdReachedEvent {
	const now = deps.now();
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.activationThresholdReached,
		timestamp: now.toISOString(),
		user_id: params.userId,
		oauth_client_id: params.signupOAuthClientId,
		hours_since_signup: Math.floor((now.getTime() - new Date(params.registeredAt).getTime()) / 3_600_000),
	};
}
