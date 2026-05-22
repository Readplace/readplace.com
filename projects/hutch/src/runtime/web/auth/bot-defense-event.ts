import type {
	BotDefenseEvent,
	BotDefenseRejectReason,
} from "@packages/test-fixtures/providers/auth";

export interface BotDefenseTrip {
	reason: BotDefenseRejectReason;
	timeToSubmitMs?: number;
}

function extractEmailDomain(body: Record<string, unknown>): string | undefined {
	const email = body.email;
	if (typeof email !== "string") return undefined;
	const at = email.indexOf("@");
	if (at === -1) return undefined;
	const domain = email.slice(at + 1).toLowerCase();
	return domain.length > 0 ? domain : undefined;
}

export function createBotDefenseEvent(input: {
	trip: BotDefenseTrip;
	ip: string | undefined;
	userAgent: string | undefined;
	body: Record<string, unknown>;
	now: Date;
}): BotDefenseEvent {
	const emailDomain = extractEmailDomain(input.body);
	const ua = input.userAgent?.slice(0, 200);
	return {
		stream: "bot-defense",
		event: "signup_rejected",
		reason: input.trip.reason,
		timestamp: input.now.toISOString(),
		...(input.ip ? { ip: input.ip } : {}),
		...(ua ? { user_agent: ua } : {}),
		...(emailDomain ? { email_domain: emailDomain } : {}),
		...(input.trip.timeToSubmitMs !== undefined
			? { time_to_submit_ms: input.trip.timeToSubmitMs }
			: {}),
	};
}
