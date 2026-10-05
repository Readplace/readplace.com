import { z } from "zod";
import type { GmailCredentialsStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GetGmailAccessToken, GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type {
	GetGmailReadonlyAccessToken,
	GmailHttpClassification,
	ObserveGmailHttpAttempt,
} from "@packages/provider-contracts/gmail-history";
import { GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { readGoogleTokenError } from "../gmail-oauth/google-token-error";
import {
	GOOGLE_OAUTH_ORIGIN,
	jsonOf,
	type ObservedBodyRead,
	observedFetch,
	present,
	readJsonBody,
} from "./gmail-http-evidence";

const TOKEN_ENDPOINT = `${GOOGLE_OAUTH_ORIGIN}/token`;

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

const unobserved: ObserveGmailHttpAttempt = () => undefined;

function refreshFields(json: unknown): Record<string, number | boolean> {
	return { accessTokenPresent: present(json, "access_token"), expiresInPresent: present(json, "expires_in") };
}

function tokenErrorFields(json: unknown): Record<string, number | boolean> {
	return { errorPresent: present(json, "error"), errorDescriptionPresent: present(json, "error_description") };
}

function initRefreshedAccessToken<TScopeRefusal extends { reason: GmailHttpClassification }>(
	deps: AccessTokenDependencies & { scope: RequestedScope<TScopeRefusal> },
): (input: {
	userId: UserId;
	forceRefresh: boolean;
	observe: ObserveGmailHttpAttempt;
}) => Promise<GmailApiResult<string> | TScopeRefusal> {
	const cached = new Map<UserId, { accessToken: string; expiresAt: number; refreshToken: string }>();

	return async ({ userId, forceRefresh, observe }) => {
		const refreshToken = await deps.credentials.findRefreshTokenByUserId(userId);
		const live = cached.get(userId);
		if (!forceRefresh && live !== undefined && live.refreshToken === refreshToken && live.expiresAt > deps.now().getTime()) {
			return { ok: true, value: live.accessToken };
		}
		cached.delete(userId);

		if (refreshToken === undefined) return { ok: false, reason: "reauth-required" };

		const { response, settle } = await observedFetch({
			fetch: deps.fetch,
			now: deps.now,
			url: TOKEN_ENDPOINT,
			init: {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: deps.clientId,
					client_secret: deps.clientSecret,
					refresh_token: refreshToken,
					grant_type: "refresh_token",
					...deps.scope.parameters,
				}).toString(),
			},
			target: {
				request: { operation: "oauth.refresh", forceRefresh },
				attempt: 1,
				requestedEndpoint: "oauth.token",
				expectedOrigin: GOOGLE_OAUTH_ORIGIN,
			},
			observe,
		});

		if (response.status === 400 || response.status === 401) {
			const body = await readJsonBody(response);
			const { error, errorDescription } = readGoogleTokenError(jsonOf(body));
			const bodyReads: ObservedBodyRead[] = [
				{ source: "response", body, accepted: error !== undefined, summarize: tokenErrorFields },
			];
			const refused = deps.scope.refusal(error);
			if (refused !== undefined) {
				deps.logger.info("[gmail-access-token] requested scope not granted", {
					userId,
					status: response.status,
					errorDescription,
				});
				settle({ classification: refused.reason, bodyReads });
				return refused;
			}
			if (error === "invalid_grant") {
				deps.logger.info("[gmail-access-token] refresh token rejected", {
					userId,
					status: response.status,
					errorDescription,
				});
				settle({ classification: "reauth-required", bodyReads });
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
			settle({ classification: "reauth-required", bodyReads });
			return { ok: false, reason: "reauth-required" };
		}
		if (!response.ok) {
			settle({ classification: "unavailable", bodyReads: [] });
			return { ok: false, reason: "unavailable", status: response.status };
		}

		const body = await readJsonBody(response);
		const refreshReads = (accepted: boolean): ObservedBodyRead[] => [
			{ source: "response", body, accepted, summarize: refreshFields },
		];
		if (body.outcome !== "decoded") {
			settle({ classification: "exception", bodyReads: refreshReads(false) });
			throw body.error;
		}
		const parsed = RefreshResponse.safeParse(body.json);
		if (!parsed.success) {
			settle({ classification: "unavailable", bodyReads: refreshReads(false) });
			return { ok: false, reason: "unavailable", status: response.status };
		}

		cached.set(userId, {
			refreshToken,
			accessToken: parsed.data.access_token,
			expiresAt: deps.now().getTime() + parsed.data.expires_in * 1000 - EXPIRY_SKEW_MS,
		});
		settle({ classification: "ok", bodyReads: refreshReads(true) });
		return { ok: true, value: parsed.data.access_token };
	};
}

export function initGmailAccessToken(deps: AccessTokenDependencies): GetGmailAccessToken {
	const refreshed = initRefreshedAccessToken<never>({
		...deps,
		scope: { parameters: {}, refusal: () => undefined },
	});
	return ({ userId, forceRefresh }) => refreshed({ userId, forceRefresh, observe: unobserved });
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
