import { initOAuthAuth } from "./oauth-auth";
import type { OAuthAuthDeps, OAuthTokens, TokenStorage } from "./auth.types";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";

function createInMemoryTokenStorage(): TokenStorage & { stored: OAuthTokens | null } {
	const store: { stored: OAuthTokens | null } = { stored: null };
	return {
		get stored() {
			return store.stored;
		},
		async getTokens() {
			return store.stored;
		},
		async setTokens(tokens: OAuthTokens) {
			store.stored = tokens;
		},
		async clearTokens() {
			store.stored = null;
		},
	};
}

function createInMemoryOAuthDeps(overrides?: Partial<OAuthAuthDeps>) {
	let capturedState = "";
	let capturedAuthorizeUrl = "";
	let capturedTokenUrl = "";
	let capturedTokenOptions: { method: string; headers: Record<string, string>; body: string } | undefined;
	let capturedCloseTabId: number | undefined;

	const openTab = async (url: string) => {
		capturedAuthorizeUrl = url;
		const parsed = new URL(url);
		capturedState = parsed.searchParams.get("state") ?? "";
		return 42;
	};

	const waitForRedirect = async () => {
		return `http://localhost:3000/oauth/callback?code=test-code&state=${capturedState}`;
	};

	const closeTab = async (tabId: number) => {
		capturedCloseTabId = tabId;
	};

	const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
		capturedTokenUrl = url;
		capturedTokenOptions = init;
		return {
			ok: true as boolean,
			status: 200,
			json: async () => ({
				access_token: "access-123",
				refresh_token: "refresh-456",
			}),
		};
	};

	return {
		serverUrl: "http://localhost:3000",
		clientId: "test-client",
		openTab,
		waitForRedirect,
		closeTab,
		fetchFn,
		tokenStorage: createInMemoryTokenStorage(),
		logger: HutchLogger.from(noopLogger),
		captured: {
			get authorizeUrl() { return capturedAuthorizeUrl; },
			get tokenUrl() { return capturedTokenUrl; },
			get tokenOptions() { return capturedTokenOptions; },
			get closeTabId() { return capturedCloseTabId; },
		},
		...overrides,
	};
}

describe("initOAuthAuth", () => {
	describe("whenLoggedIn before login", () => {
		it("should return not-logged-in", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			const result = auth.whenLoggedIn(() => "value");
			expect(result).toEqual({ ok: false, reason: "not-logged-in" });
		});
	});

	describe("login", () => {
		it("should open a tab with the authorize URL", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			await auth.login();

			const url = deps.captured.authorizeUrl;
			expect(url).toContain("http://localhost:3000/oauth/authorize");
			expect(url).toContain("client_id=test-client");
			expect(url).toContain("response_type=code");
			expect(url).toContain("code_challenge_method=S256");
			expect(url).toContain("code_challenge=");
			expect(url).toContain("state=");
		});

		it("should wait for redirect to callback URL", async () => {
			let capturedRedirectParams: { tabId: number; urlPrefix: string } | undefined;
			const deps = createInMemoryOAuthDeps({
				waitForRedirect: async (params) => {
					capturedRedirectParams = params;
					return `http://localhost:3000/oauth/callback?code=test-code&state=${new URL(deps.captured.authorizeUrl).searchParams.get("state")}`;
				},
			});
			const auth = await initOAuthAuth(deps);

			await auth.login();

			expect(capturedRedirectParams).toEqual({
				tabId: 42,
				urlPrefix: "http://localhost:3000/oauth/callback",
			});
		});

		it("should close the tab after redirect", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			await auth.login();

			expect(deps.captured.closeTabId).toBe(42);
		});

		it("should exchange code for tokens", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			await auth.login();

			expect(deps.captured.tokenUrl).toBe("http://localhost:3000/oauth/token");
			expect(deps.captured.tokenOptions?.method).toBe("POST");
			expect(deps.captured.tokenOptions?.body).toContain("grant_type=authorization_code");
			expect(deps.captured.tokenOptions?.body).toContain("code=test-code");
			expect(deps.captured.tokenOptions?.body).toContain("client_id=test-client");
			expect(deps.captured.tokenOptions?.body).toContain("code_verifier=");
		});

		it("should store tokens after successful exchange", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({ tokenStorage });
			const auth = await initOAuthAuth(deps);

			await auth.login();

			expect(tokenStorage.stored).toEqual({
				accessToken: "access-123",
				refreshToken: "refresh-456",
			});
		});

		it("should be logged in after login", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			await auth.login();

			const result = auth.whenLoggedIn(() => "hello");
			expect(result).toEqual({ ok: true, value: "hello" });
		});

		it("should throw when OAuth returns an error", async () => {
			const deps = createInMemoryOAuthDeps({
				waitForRedirect: async () =>
					"http://localhost:3000/oauth/callback?error=access_denied",
			});
			const auth = await initOAuthAuth(deps);

			await expect(auth.login()).rejects.toThrow("OAuth authorization denied");
		});

		it("should throw when callback has no code", async () => {
			const deps = createInMemoryOAuthDeps({
				waitForRedirect: async () =>
					"http://localhost:3000/oauth/callback?state=anything",
			});
			const auth = await initOAuthAuth(deps);

			await expect(auth.login()).rejects.toThrow("No authorization code");
		});

		it("should throw on state mismatch", async () => {
			const deps = createInMemoryOAuthDeps({
				waitForRedirect: async () =>
					"http://localhost:3000/oauth/callback?code=test-code&state=wrong-state",
			});
			const auth = await initOAuthAuth(deps);

			await expect(auth.login()).rejects.toThrow("state mismatch");
		});

		it("should throw when token exchange fails", async () => {
			const deps = createInMemoryOAuthDeps({
				fetchFn: async () => ({ ok: false as boolean, status: 400, json: async () => ({}) }),
			});
			const auth = await initOAuthAuth(deps);

			await expect(auth.login()).rejects.toThrow("Token exchange failed");
		});

		it("should throw when token response has invalid shape", async () => {
			const deps = createInMemoryOAuthDeps({
				fetchFn: async () => ({
					ok: true as boolean,
					status: 200,
					json: async () => ({ unexpected: "shape" }),
				}),
			});
			const auth = await initOAuthAuth(deps);

			await expect(auth.login()).rejects.toThrow();
		});
	});

	describe("logout", () => {
		it("should revoke tokens on the server", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			let revokeUrl = "";
			let revokeOptions: { method: string; headers: Record<string, string>; body?: string } | undefined;
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (url, init) => {
					revokeUrl = url;
					revokeOptions = init;
					return { ok: true, status: 200, json: async () => ({ access_token: "access-123", refresh_token: "refresh-456" }) };
				},
			});
			const auth = await initOAuthAuth(deps);

			await auth.login();

			revokeUrl = "";
			revokeOptions = undefined;

			await auth.logout();

			expect(revokeUrl).toBe("http://localhost:3000/oauth/revoke");
			expect(revokeOptions).toEqual(expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ token: "refresh-456" }),
			}));
		});

		it("should clear stored tokens", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({ tokenStorage });
			const auth = await initOAuthAuth(deps);

			await auth.login();
			expect(tokenStorage.stored).not.toBeNull();

			await auth.logout();
			expect(tokenStorage.stored).toBeNull();
		});

		it("should be logged out after logout", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			await auth.login();
			await auth.logout();

			const result = auth.whenLoggedIn(() => "value");
			expect(result).toEqual({ ok: false, reason: "not-logged-in" });
		});
	});

	describe("ensureWebSession", () => {
		it("posts the bearer token to /auth/session with credentials to mint the reader cookie", async () => {
			let sessionUrl = "";
			let sessionInit:
				| { method: string; headers: Record<string, string>; body?: string; credentials?: string }
				| undefined;
			const deps = createInMemoryOAuthDeps({
				fetchFn: async (url, init) => {
					if (url.endsWith("/auth/session")) {
						sessionUrl = url;
						sessionInit = init;
					}
					return { ok: true, status: 200, json: async () => ({ access_token: "access-123", refresh_token: "refresh-456" }) };
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.ensureWebSession();

			expect(sessionUrl).toBe("http://localhost:3000/auth/session");
			expect(sessionInit).toEqual({
				method: "POST",
				headers: { Authorization: "Bearer access-123" },
				credentials: "include",
			});
		});

		it("does nothing when there is no stored token", async () => {
			let sessionCalled = false;
			const deps = createInMemoryOAuthDeps({
				fetchFn: async (url) => {
					if (url.endsWith("/auth/session")) sessionCalled = true;
					return { ok: true, status: 200, json: async () => ({ access_token: "access-123", refresh_token: "refresh-456" }) };
				},
			});
			const auth = await initOAuthAuth(deps);

			await auth.ensureWebSession();

			expect(sessionCalled).toBe(false);
		});
	});

	describe("whenLoggedIn callback throws", () => {
		it("should catch the error and return it", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);
			await auth.login();
			const thrownError = new Error("something broke");

			const result = auth.whenLoggedIn(() => {
				throw thrownError;
			});

			expect(result.ok).toBe(false);
			if (!result.ok && result.reason === "error") {
				expect(result.error).toBe(thrownError);
			}
		});

		it("should wrap non-Error thrown values in an Error", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = auth.whenLoggedIn(() => {
				throw 42;
			});

			expect(result.ok).toBe(false);
			if (!result.ok && result.reason === "error") {
				expect(result.error).toBeInstanceOf(Error);
				expect(result.error.message).toBe("42");
			}
		});
	});

	describe("session restoration", () => {
		it("should restore logged-in state from stored tokens", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			await tokenStorage.setTokens({
				accessToken: "stored-access",
				refreshToken: "stored-refresh",
			});

			const deps = createInMemoryOAuthDeps({ tokenStorage });
			const auth = await initOAuthAuth(deps);

			const result = auth.whenLoggedIn(() => "restored");
			expect(result).toEqual({ ok: true, value: "restored" });
		});

		it("should restore the session from stored tokens without contacting the token endpoint", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			await tokenStorage.setTokens({
				accessToken: "stored-access",
				refreshToken: "stored-refresh",
			});

			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async () => {
					throw new Error("construction must not spend a token grant");
				},
			});
			const auth = await initOAuthAuth(deps);

			const result = auth.whenLoggedIn(() => "restored");
			expect(result).toEqual({ ok: true, value: "restored" });
			expect(tokenStorage.stored).toEqual({
				accessToken: "stored-access",
				refreshToken: "stored-refresh",
			});
		});
	});

	describe("refreshTokens", () => {
		it("should exchange refresh token for new tokens", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			let capturedUrl = "";
			let capturedBody = "";
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (url, init) => {
					capturedUrl = url;
					capturedBody = init.body ?? "";
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "new-access-token",
							refresh_token: "new-refresh-token",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: true });
			expect(capturedUrl).toBe("http://localhost:3000/oauth/token");
			expect(capturedBody).toContain("grant_type=refresh_token");
			expect(capturedBody).toContain("client_id=test-client");
		});

		it("should store new tokens after successful refresh", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "refreshed-access",
								refresh_token: "refreshed-refresh",
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();

			expect(tokenStorage.stored).toEqual({
				accessToken: "refreshed-access",
				refreshToken: "refreshed-refresh",
			});
		});

		it("should remain logged in after successful refresh", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "new-access",
								refresh_token: "new-refresh",
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();

			const guarded = auth.whenLoggedIn(() => "still-here");
			expect(guarded).toEqual({ ok: true, value: "still-here" });
		});

		it("should return no-refresh-token when no tokens are stored", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: false, reason: "no-refresh-token" });
		});

		it("should log out when no refresh token is available", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			await tokenStorage.setTokens({ accessToken: "access", refreshToken: "" });
			const deps = createInMemoryOAuthDeps({ tokenStorage });
			const auth = await initOAuthAuth(deps);

			await auth.refreshTokens();

			const guarded = auth.whenLoggedIn(() => "value");
			expect(guarded).toEqual({ ok: false, reason: "not-logged-in" });
		});

		it("should clear tokens when no refresh token is available", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			await tokenStorage.setTokens({ accessToken: "access", refreshToken: "" });
			const deps = createInMemoryOAuthDeps({ tokenStorage });
			const auth = await initOAuthAuth(deps);

			await auth.refreshTokens();

			expect(tokenStorage.stored).toBeNull();
		});

		it("should return refresh-failed when server rejects the refresh token", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return { ok: false as boolean, status: 400, json: async () => ({}) };
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: false, reason: "refresh-failed" });
		});

		it("should clear tokens and log out on failed refresh", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return { ok: false as boolean, status: 400, json: async () => ({}) };
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();

			expect(tokenStorage.stored).toBeNull();
			const guarded = auth.whenLoggedIn(() => "value");
			expect(guarded).toEqual({ ok: false, reason: "not-logged-in" });
		});

		it("should keep the session when the token response has an unexpected shape", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({ unexpected: "shape" }),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: false, reason: "unavailable" });
			expect(tokenStorage.stored).toEqual({
				accessToken: "access-123",
				refreshToken: "refresh-456",
			});
			expect(auth.whenLoggedIn(() => "value")).toEqual({ ok: true, value: "value" });
		});

		it("shares one token grant between concurrent refresh calls", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			let refreshGrants = 0;
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						refreshGrants += 1;
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "rotated-access",
								refresh_token: "rotated-refresh",
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const [first, second] = await Promise.all([
				auth.refreshTokens(),
				auth.refreshTokens(),
			]);

			expect(first).toEqual({ ok: true });
			expect(second).toEqual({ ok: true });
			expect(refreshGrants).toBe(1);
			expect(tokenStorage.stored).toEqual({
				accessToken: "rotated-access",
				refreshToken: "rotated-refresh",
			});
		});

		it("starts a new token grant once the previous one has settled", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			let refreshGrants = 0;
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						refreshGrants += 1;
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: `access-${refreshGrants}`,
								refresh_token: `refresh-${refreshGrants}`,
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();
			await auth.refreshTokens();

			expect(refreshGrants).toBe(2);
		});

		it.each([429, 500, 502, 503])(
			"keeps the session when the token endpoint answers %i",
			async (status) => {
				const tokenStorage = createInMemoryTokenStorage();
				const deps = createInMemoryOAuthDeps({
					tokenStorage,
					fetchFn: async (_url, init) => {
						if (init.body?.includes("grant_type=refresh_token")) {
							return { ok: false as boolean, status, json: async () => ({}) };
						}
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "access-123",
								refresh_token: "refresh-456",
							}),
						};
					},
				});
				const auth = await initOAuthAuth(deps);
				await auth.login();

				const result = await auth.refreshTokens();

				expect(result).toEqual({ ok: false, reason: "unavailable" });
				expect(tokenStorage.stored).toEqual({
					accessToken: "access-123",
					refreshToken: "refresh-456",
				});
				expect(auth.whenLoggedIn(() => "value")).toEqual({ ok: true, value: "value" });
			},
		);

		it("keeps the session when the token request throws", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						throw new Error("network down");
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: false, reason: "unavailable" });
			expect(tokenStorage.stored).toEqual({
				accessToken: "access-123",
				refreshToken: "refresh-456",
			});
			expect(auth.whenLoggedIn(() => "value")).toEqual({ ok: true, value: "value" });
		});

		it("keeps the session when the token response body is not JSON", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => {
								throw new Error("Unexpected end of JSON input");
							},
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: false, reason: "unavailable" });
			expect(tokenStorage.stored).toEqual({
				accessToken: "access-123",
				refreshToken: "refresh-456",
			});
		});

		it("should send the stored refresh token in the request body", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			let capturedBody = "";
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					capturedBody = init.body ?? "";
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "new-access",
								refresh_token: "new-refresh",
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();

			expect(capturedBody).toContain("refresh_token=refresh-456");
		});
	});

	describe("getAccessToken", () => {
		it("should return null when no tokens are stored", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);

			const token = await auth.getAccessToken();

			expect(token).toBeNull();
		});

		it("should return the stored access token", async () => {
			const deps = createInMemoryOAuthDeps();
			const auth = await initOAuthAuth(deps);
			await auth.login();

			const token = await auth.getAccessToken();

			expect(token).toBe("access-123");
		});

		it("should return updated token after refresh", async () => {
			const tokenStorage = createInMemoryTokenStorage();
			const deps = createInMemoryOAuthDeps({
				tokenStorage,
				fetchFn: async (_url, init) => {
					if (init.body?.includes("grant_type=refresh_token")) {
						return {
							ok: true as boolean,
							status: 200,
							json: async () => ({
								access_token: "refreshed-access",
								refresh_token: "refreshed-refresh",
							}),
						};
					}
					return {
						ok: true as boolean,
						status: 200,
						json: async () => ({
							access_token: "access-123",
							refresh_token: "refresh-456",
						}),
					};
				},
			});
			const auth = await initOAuthAuth(deps);
			await auth.login();

			await auth.refreshTokens();
			const token = await auth.getAccessToken();

			expect(token).toBe("refreshed-access");
		});
	});
});
