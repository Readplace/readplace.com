import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { ANALYTICS_EVENTS, STREAMS } from "./events";
import { buildActivationThresholdReachedEvent } from "./funnel-events";

const userId = UserIdSchema.parse("reader");
const REGISTERED_AT = "2026-11-01T00:00:00.000Z";

describe("buildActivationThresholdReachedEvent", () => {
	it("floors hours_since_signup at the 71 h 59 min boundary and carries the signup client", () => {
		const now = new Date("2026-11-03T23:59:00.000Z");
		const signupOAuthClientId = OAuthClientIdSchema.parse("hutch-firefox-extension");

		const event = buildActivationThresholdReachedEvent(
			{ now: () => now },
			{ userId, registeredAt: REGISTERED_AT, signupOAuthClientId },
		);

		expect(event).toEqual({
			stream: STREAMS.analytics,
			event: ANALYTICS_EVENTS.activationThresholdReached,
			timestamp: now.toISOString(),
			user_id: userId,
			oauth_client_id: signupOAuthClientId,
			hours_since_signup: 71,
		});
	});

	it("writes oauth_client_id as null for a web or email signup rather than omitting it", () => {
		const event = buildActivationThresholdReachedEvent(
			{ now: () => new Date("2026-11-01T01:00:00.000Z") },
			{ userId, registeredAt: REGISTERED_AT, signupOAuthClientId: null },
		);

		expect(Object.keys(event)).toContain("oauth_client_id");
		expect(event.oauth_client_id).toBeNull();
		expect(event.hours_since_signup).toBe(1);
	});
});
