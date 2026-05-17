import type { UserId } from "@packages/domain/user";

export interface ConversionEvent {
	stream: "conversions";
	event: "user_created";
	timestamp: string;
	user_id: UserId;
	email_hash: string;
	method: "email" | "google";
	tier: "free" | "paid";
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	referrer_host?: string;
	first_seen_at?: string;
	landing_path?: string;
	stripe_checkout_session_id?: string;
}
