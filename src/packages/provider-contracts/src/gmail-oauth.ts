export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

export interface GmailGrant {
	refreshToken: string;
	accessToken: string;
	grantedScope: string;
	googleAccountEmail: string;
}

export type GmailGrantResult =
	| { ok: true; grant: GmailGrant }
	| { ok: false; reason: "scope-not-granted" }
	| { ok: false; reason: "no-refresh-token" }
	| { ok: false; reason: "exchange-failed" };

export type ExchangeGmailCode = (input: { code: string }) => Promise<GmailGrantResult>;
