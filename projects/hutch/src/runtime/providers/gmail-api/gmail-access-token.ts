import { z } from "zod";
import type { GmailCredentialsStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GetGmailAccessToken, GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GetGmailReadonlyAccessToken } from "@packages/provider-contracts/gmail-history";
import { GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { readGoogleTokenError } from "../gmail-oauth/google-token-error";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const EXPIRY_SKEW_MS = 60_000;

const RefreshResponse = z.object({
	access_token: z.string(),
	expires_in: z.number(),
});

interface AccessTokenDependencies {
	clientId: string;
	clientSecret: string;
	credentials: GmailCredentialsStore;
	fetch: typeof globalThis.fetch;
	now: () => Date;
	logger: HutchLogger;
}

interface RequestedScope<TScopeRefusal> {
	parameters: Record<string, string>;
	refusal: (error: string | undefined) => TScopeRefusal | undefined;
}

function initRefreshedAccessToken<TScopeRefusal>(
	deps: AccessTokenDependencies & { scope: RequestedScope<TScopeRefusal> },
): (input: { userId: UserId; forceRefresh: boolean }) => Promise<GmailApiResult<string> | TScopeRefusal> {
	const cached = new Map<UserId, { accessToken: string; expiresAt: number; refreshToken: string }>();

	return async ({ userId, forceRefresh }) => {
		const refreshToken = await deps.credentials.findRefreshTokenByUserId(userId);
		const live = cached.get(userId);
		if (!forceRefresh && live !== undefined && live.refreshToken === refreshToken && live.expiresAt > deps.now().getTime()) {
			return { ok: true, value: live.accessToken };
		}
		cached.delete(userId);

		if (refreshToken === undefined) return { ok: false, reason: "reauth-required" };

		const response = await deps.fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: deps.clientId,
				client_secret: deps.clientSecret,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
				...deps.scope.parameters,
			}).toString(),
		});

		if (response.status === 400 || response.status === 401) {
			const { error, errorDescription } = readGoogleTokenError(await response.json().catch(() => undefined));
			const refused = deps.scope.refusal(error);
			if (refused !== undefined) {
				deps.logger.info("[gmail-access-token] requested scope not granted", {
					userId,
					status: response.status,
					errorDescription,
				});
				return refused;
			}
			if (error === "invalid_grant") {
				deps.logger.info("[gmail-access-token] refresh token rejected", {
					userId,
					status: response.status,
					errorDescription,
				});
				return { ok: false, reason: "reauth-required" };
			}
			deps.logger.error(
				JSON.stringify({
					level: "ERROR",
					message: "[gmail-access-token] token endpoint refused our client",
					userId,
					status: response.status,
					error,
					errorDescription,
				}),
			);
			return { ok: false, reason: "reauth-required" };
		}
		if (!response.ok) return { ok: false, reason: "unavailable", status: response.status };

		const parsed = RefreshResponse.safeParse(await response.json());
		if (!parsed.success) return { ok: false, reason: "unavailable", status: response.status };

		cached.set(userId, {
			refreshToken,
			accessToken: parsed.data.access_token,
			expiresAt: deps.now().getTime() + parsed.data.expires_in * 1000 - EXPIRY_SKEW_MS,
		});
		return { ok: true, value: parsed.data.access_token };
	};
}

export function initGmailAccessToken(deps: AccessTokenDependencies): GetGmailAccessToken {
	return initRefreshedAccessToken<never>({
		...deps,
		scope: { parameters: {}, refusal: () => undefined },
	});
}

export function initGmailReadonlyAccessToken(deps: AccessTokenDependencies): GetGmailReadonlyAccessToken {
	return initRefreshedAccessToken({
		...deps,
		scope: {
			parameters: { scope: GMAIL_READONLY_SCOPE },
			refusal: (error) =>
				error === "invalid_scope" ? ({ ok: false, reason: "readonly-permission-required" } as const) : undefined,
		},
	});
}
