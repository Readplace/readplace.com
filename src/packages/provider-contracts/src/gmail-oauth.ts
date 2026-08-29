export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

export interface GmailGrant {
	refreshToken: string;
	accessToken: string;
	grantedScope: string;
}

export type GmailGrantResult =
	| { ok: true; grant: GmailGrant }
	| { ok: false; reason: "scope-not-granted" }
	| { ok: false; reason: "no-refresh-token" }
	| { ok: false; reason: "exchange-failed" };

export type ExchangeGmailCode = (input: { code: string }) => Promise<GmailGrantResult>;

export type RevokeGmailGrantResult =
	| { ok: true }
	| { ok: false; reason: "unavailable"; status: number };

export type RevokeGmailGrant = (input: {
	refreshToken: string;
}) => Promise<RevokeGmailGrantResult>;
