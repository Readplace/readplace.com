import type { HutchLogger } from "@packages/hutch-logger";
import type { OAuthTokens } from "./oauth-tokens";

export type { OAuthTokens };

export type LoginResult = { ok: true };

export type RefreshResult =
	| { ok: true }
	| { ok: false; reason: "no-refresh-token" }
	| { ok: false; reason: "refresh-failed" };

export type GuardedResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: "not-logged-in" }
	| { ok: false; reason: "error"; error: Error };

export type Login = () => Promise<LoginResult>;

export type Logout = () => Promise<void>;

export type RefreshTokens = () => Promise<RefreshResult>;

export type GetAccessToken = () => Promise<string | null>;

/** Mints a browser session cookie from the stored bearer. The reader at
 * /queue/:id/view authorizes the owner from the hutch_sid cookie, never a
 * bearer, so a list link followed into a normal tab needs that cookie to land
 * on the private reader instead of the public /view fallback. */
export type EnsureWebSession = () => Promise<void>;

export type WhenLoggedIn = <T>(fn: () => T) => GuardedResult<T>;

export interface Auth {
	login: Login;
	logout: Logout;
	refreshTokens: RefreshTokens;
	getAccessToken: GetAccessToken;
	ensureWebSession: EnsureWebSession;
	whenLoggedIn: WhenLoggedIn;
}

export interface TokenStorage {
	getTokens(): Promise<OAuthTokens | null>;
	setTokens(tokens: OAuthTokens): Promise<void>;
	clearTokens(): Promise<void>;
}

export interface OAuthAuthDeps {
	serverUrl: string;
	clientId: string;
	openTab(url: string): Promise<number>;
	waitForRedirect(params: { tabId: number; urlPrefix: string }): Promise<string>;
	closeTab(tabId: number): Promise<void>;
	fetchFn(url: string, init: { method: string; headers: Record<string, string>; body?: string; credentials?: "include" }): Promise<{ ok: boolean; status: number; json(): Promise<Record<string, string>> }>;
	tokenStorage: TokenStorage;
	logger: HutchLogger;
}
