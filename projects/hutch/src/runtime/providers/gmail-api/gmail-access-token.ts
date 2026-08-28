import { z } from "zod";
import type { GmailCredentialsStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GetGmailAccessToken } from "@packages/provider-contracts/gmail-filters";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const EXPIRY_SKEW_MS = 60_000;

const RefreshResponse = z.object({
	access_token: z.string(),
	expires_in: z.number(),
});

export function initGmailAccessToken(deps: {
	clientId: string;
	clientSecret: string;
	credentials: GmailCredentialsStore;
	fetch: typeof globalThis.fetch;
	now: () => Date;
}): GetGmailAccessToken {
	const cached = new Map<UserId, { accessToken: string; expiresAt: number }>();

	return async ({ userId, forceRefresh }) => {
		const live = cached.get(userId);
		if (!forceRefresh && live !== undefined && live.expiresAt > deps.now().getTime()) {
			return { ok: true, value: live.accessToken };
		}
		cached.delete(userId);

		const refreshToken = await deps.credentials.findRefreshTokenByUserId(userId);
		if (refreshToken === undefined) return { ok: false, reason: "reauth-required" };

		const response = await deps.fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: deps.clientId,
				client_secret: deps.clientSecret,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
			}).toString(),
		});

		if (response.status === 400 || response.status === 401) {
			return { ok: false, reason: "reauth-required" };
		}
		if (!response.ok) return { ok: false, reason: "unavailable", status: response.status };

		const parsed = RefreshResponse.safeParse(await response.json());
		if (!parsed.success) return { ok: false, reason: "unavailable", status: response.status };

		cached.set(userId, {
			accessToken: parsed.data.access_token,
			expiresAt: deps.now().getTime() + parsed.data.expires_in * 1000 - EXPIRY_SKEW_MS,
		});
		return { ok: true, value: parsed.data.access_token };
	};
}
