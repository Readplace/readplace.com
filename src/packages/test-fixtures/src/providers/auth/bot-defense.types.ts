export type BotDefenseRejectReason =
	| "honeypot"
	| "submit_too_fast"
	| "missing_timestamp"
	| "invalid_timestamp";

export interface BotDefenseEvent {
	stream: "bot-defense";
	event: "signup_rejected";
	reason: BotDefenseRejectReason;
	timestamp: string;
	ip?: string;
	user_agent?: string;
	email_domain?: string;
	time_to_submit_ms?: number;
}
