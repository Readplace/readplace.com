import type { Auth, EnsureWebSession, GetAccessToken, Login, Logout, RefreshTokens, WhenLoggedIn } from "./auth.types";

export function initInMemoryAuth(): Auth {
	let loggedIn = false;

	const login: Login = async () => {
		loggedIn = true;
		return { ok: true };
	};

	const logout: Logout = async () => {
		loggedIn = false;
	};

	const refreshTokens: RefreshTokens = async () => {
		return { ok: true };
	};

	const getAccessToken: GetAccessToken = async () => {
		return loggedIn ? "in-memory-token" : null;
	};

	const ensureWebSession: EnsureWebSession = async () => {};

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

	return {
		login,
		logout,
		refreshTokens,
		getAccessToken,
		ensureWebSession,
		whenLoggedIn,
	};
}
