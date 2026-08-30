import "../zod-config";
import { z } from "zod";
import type { Auth, LoginResult, OAuthAuthDeps, RefreshResult, WhenLoggedIn } from "./auth.types";
import { generateCodeVerifier, generateCodeChallenge } from "./pkce";

const TokenResponse = z.object({
	access_token: z.string(),
	refresh_token: z.string(),
});

export async function initOAuthAuth(deps: OAuthAuthDeps): Promise<Auth> {
	let loggedIn = false;

	const login = async (): Promise<LoginResult> => {
		const serverUrl = deps.serverUrl;
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		const state = generateCodeVerifier();
		const redirectUri = `${serverUrl}/oauth/callback`;

		const authorizeUrl = new URL(`${serverUrl}/oauth/authorize`);
		authorizeUrl.searchParams.set("client_id", deps.clientId);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("code_challenge", codeChallenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		authorizeUrl.searchParams.set("state", state);

		const tabId = await deps.openTab(authorizeUrl.toString());

		const callbackUrl = await deps.waitForRedirect({
			tabId,
			urlPrefix: redirectUri,
		});

		await deps.closeTab(tabId);

		const callbackParams = new URL(callbackUrl).searchParams;
		const error = callbackParams.get("error");
		if (error) {
			throw new Error(`OAuth authorization denied: ${error}`);
		}

		const code = callbackParams.get("code");
		if (!code) {
			throw new Error("No authorization code in callback URL");
		}

		const returnedState = callbackParams.get("state");
		if (returnedState !== state) {
			throw new Error("OAuth state mismatch");
		}

		const tokenResponse = await deps.fetchFn(`${serverUrl}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: deps.clientId,
				code_verifier: codeVerifier,
			}).toString(),
		});

		if (!tokenResponse.ok) {
			throw new Error(`Token exchange failed: ${tokenResponse.status}`);
		}

		const tokenData = TokenResponse.parse(await tokenResponse.json());

		await deps.tokenStorage.setTokens({
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token,
		});

		loggedIn = true;
		return { ok: true };
	};

	let refreshing: Promise<RefreshResult> | undefined;

	const requestGrant = async (
		refreshToken: string,
	): Promise<
		| { outcome: "granted"; accessToken: string; refreshToken: string }
		| { outcome: "rejected" }
		| { outcome: "unavailable" }
	> => {
		let response: Awaited<ReturnType<typeof deps.fetchFn>>;
		try {
			response = await deps.fetchFn(`${deps.serverUrl}/oauth/token`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: deps.clientId,
				}).toString(),
			});
		} catch (error) {
			deps.logger.warn("Token refresh could not reach the server:", error);
			return { outcome: "unavailable" };
		}

		if (response.status === 400) return { outcome: "rejected" };
		if (!response.ok) {
			deps.logger.warn(`Token refresh unavailable: ${response.status}`);
			return { outcome: "unavailable" };
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			deps.logger.warn("Token refresh returned an unreadable body:", error);
			return { outcome: "unavailable" };
		}

		const tokenData = TokenResponse.safeParse(body);
		if (!tokenData.success) {
			deps.logger.warn("Token refresh returned an unexpected body");
			return { outcome: "unavailable" };
		}

		return {
			outcome: "granted",
			accessToken: tokenData.data.access_token,
			refreshToken: tokenData.data.refresh_token,
		};
	};

	const exchangeRefreshToken = async (): Promise<RefreshResult> => {
		const storedTokens = await deps.tokenStorage.getTokens();
		if (!storedTokens?.refreshToken) {
			await deps.tokenStorage.clearTokens();
			loggedIn = false;
			return { ok: false, reason: "no-refresh-token" };
		}

		const grant = await requestGrant(storedTokens.refreshToken);
		if (grant.outcome === "unavailable") {
			return { ok: false, reason: "unavailable" };
		}
		if (grant.outcome === "rejected") {
			await deps.tokenStorage.clearTokens();
			loggedIn = false;
			return { ok: false, reason: "refresh-failed" };
		}

		await deps.tokenStorage.setTokens({
			accessToken: grant.accessToken,
			refreshToken: grant.refreshToken,
		});
		loggedIn = true;
		return { ok: true };
	};

	const refreshTokens = async (): Promise<RefreshResult> => {
		refreshing ??= exchangeRefreshToken().finally(() => {
			refreshing = undefined;
		});
		return refreshing;
	};

	const getAccessToken = async (): Promise<string | null> => {
		const storedTokens = await deps.tokenStorage.getTokens();
		return storedTokens?.accessToken ?? null;
	};

	const ensureWebSession = async (): Promise<void> => {
		const token = await getAccessToken();
		if (!token) return;
		await deps.fetchFn(`${deps.serverUrl}/auth/session`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			credentials: "include",
		});
	};

	const logout = async (): Promise<void> => {
		const serverUrl = deps.serverUrl;
		const tokens = await deps.tokenStorage.getTokens();
		if (tokens) {
			await deps.fetchFn(`${serverUrl}/oauth/revoke`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: tokens.refreshToken }),
			}).catch((err) => deps.logger.warn("Token revocation failed:", err));
		}

		await deps.tokenStorage.clearTokens();
		loggedIn = false;
	};

	const whenLoggedIn: WhenLoggedIn = (fn) => {
		if (!loggedIn) {
			return { ok: false, reason: "not-logged-in" };
		}
		try {
			const value = fn();
			return { ok: true, value };
		} catch (thrown) {
			const error =
				thrown instanceof Error ? thrown : new Error(String(thrown));
			return { ok: false, reason: "error", error };
		}
	};

	const storedTokens = await deps.tokenStorage.getTokens();
	loggedIn = storedTokens !== null;

	return { login, logout, refreshTokens, getAccessToken, ensureWebSession, whenLoggedIn };
}
