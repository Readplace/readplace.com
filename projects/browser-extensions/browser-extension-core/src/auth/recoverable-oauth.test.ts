import assert from "node:assert";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { AuthState, AuthStateStore } from "./auth-state.types";
import { initRecoverableOAuthAuth } from "./recoverable-oauth";
import { initRefreshProof } from "./refresh-proof";

const now = Date.parse("2026-10-16T00:00:00Z");
const json = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

async function fixture() {
	const proof = initRefreshProof({ crypto, now: () => now, uuid: () => crypto.randomUUID() });
	let value: AuthState = { version: 1, installationId: crypto.randomUUID(), epoch: crypto.randomUUID(), key: await proof.createKey(), credentials: { accessToken: "A0", refreshToken: "R0", bound: false }, pending: null, journal: [] };
	let failCommit = false;
	const store: AuthStateStore = {
		async read() { return structuredClone(value); },
		async update(mutate) {
			const next = structuredClone(value);
			const result = mutate(next);
			if (failCommit && next.credentials?.accessToken !== value.credentials?.accessToken) throw new Error("disk full");
			value = next;
			return result;
		},
	};
	const requests: { url: string; init: RequestInit }[] = [];
	let generation = 0;
	function issued(init: RequestInit, options?: { recovered?: boolean; expired?: boolean }) {
		generation++;
		const operation = new URLSearchParams(String(init.body)).get("readplace_refresh_operation_id");
		return json({ access_token: `A${generation}`, refresh_token: `R${generation}`, ...(operation ? { readplace: {
			protocol: 1, operation_id: operation, grant_id: "grant", generation, recovered: options?.recovered ?? false,
			access_expires_at: new Date(now + (options?.expired ? -1 : 3_600_000)).toISOString(), refresh_expires_at: new Date(now + 180 * 86_400_000).toISOString(), diagnostics_permit: "upload-only-permit",
		} } : {}) });
	}
	let answer = async (_url: string, init: RequestInit): Promise<Response> => issued(init);
	let metadata = json({ readplace_refresh_protocols_supported: [1], readplace_refresh_enrollment_enabled: true, readplace_auth_diagnostics_endpoint: "https://readplace.test/diagnostics/auth" });
	let callbackState = "";
	let callbackOverride: string | undefined;
	const deps = {
		keepAlive: <T>(work: Promise<T>) => work,
		store, proof, serverUrl: "https://readplace.test", clientId: "hutch-chrome-extension", client: "chrome" as const,
		version: "1.0.700", contextId: crypto.randomUUID(), now: () => now, uuid: () => crypto.randomUUID(), logger: HutchLogger.from(noopLogger),
		async openTab(url: string) { callbackState = new URL(url).searchParams.get("state") ?? ""; return 1; },
		async waitForRedirect() { return callbackOverride ?? `https://readplace.test/oauth/callback?code=code&state=${callbackState}`; },
		async closeTab() {},
		fetchFn: (async (url: string | URL | Request, init: RequestInit = {}) => {
			const target = String(url);
			if (target.endsWith("/.well-known/oauth-authorization-server")) return metadata.clone();
			if (target.endsWith("/diagnostics/auth")) return json({ accepted_event_ids: [] });
			requests.push({ url: target, init });
			return answer(target, init);
		}) satisfies typeof fetch,
	};
	return {
		deps, store, requests, issued,
		answer(fn: typeof answer) { answer = fn; },
		metadata(response: Response) { metadata = response; },
		callback(url: string) { callbackOverride = url; },
		failCommit(value: boolean) { failCommit = value; },
	};
}

describe("recoverable browser authentication", () => {
	it("keeps auth unavailable when the storage containing diagnostics also fails", async () => {
		const f = await fixture(); const auth = await initRecoverableOAuthAuth(f.deps);
		f.store.update = async () => { throw new Error("disk unavailable"); };
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		expect(await auth.getAccessToken()).toBe("A0");
	});

	it("retains the upload capability supplied on a fresh login", async () => {
		const f = await fixture(); f.answer(async () => json({ access_token: "new", refresh_token: "new-refresh", diagnostics_permit: "new-permit" }));
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.login();
		const state = await f.store.read();
		expect(state.permit).toBe("new-permit");
		expect(state.journal.find(entry => entry.event.event === "login_started")?.permit).toBe("new-permit");
		expect(state.journal.find(entry => entry.event.event === "context_started")?.permit).toBeUndefined();
	});

	it("accepts an upload capability inside protocol metadata without prematurely binding the login", async () => {
		const f = await fixture(); f.answer(async () => f.issued({ body: new URLSearchParams({ readplace_refresh_operation_id: crypto.randomUUID() }).toString() }));
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.login();
		expect((await f.store.read()).permit).toBe("upload-only-permit");
		expect((await f.store.read()).credentials?.bound).toBe(false);
	});

	it("prepares durable operation before HTTP and coalesces concurrent refreshes", async () => {
		const f = await fixture();
		f.answer(async (_url, init) => {
			const stored = await f.store.read();
			expect(stored.pending?.id).toBe(new URLSearchParams(String(init.body)).get("readplace_refresh_operation_id"));
			expect(new Headers(init.headers).get("DPoP")?.split(".")).toHaveLength(3);
			return f.issued(init);
		});
		const auth = await initRecoverableOAuthAuth(f.deps);
		const results = await Promise.all(Array.from({ length: 20 }, () => auth.refreshTokens({ refusedAccessToken: "A0" })));
		expect(results.every(result => result.ok)).toBe(true);
		expect(f.requests).toHaveLength(1);
		expect((await f.store.read()).pending).toBeNull();
		expect(await auth.getAccessToken()).toBe("A1");
		await auth.refreshTokens({ refusedAccessToken: "A0" });
		expect(f.requests).toHaveLength(1);
	});

	it("resumes the same persisted operation after an unreadable successful response and a worker restart", async () => {
		const f = await fixture();
		f.answer(async () => new Response("truncated", { status: 200 }));
		const first = await initRecoverableOAuthAuth(f.deps);
		expect(await first.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		const operation = (await f.store.read()).pending?.id;
		f.answer(async (_url, init) => f.issued(init, { recovered: true }));
		const restarted = await initRecoverableOAuthAuth({ ...f.deps, contextId: crypto.randomUUID() });
		expect(await restarted.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: true });
		expect(f.requests.map(request => new URLSearchParams(String(request.init.body)).get("readplace_refresh_operation_id"))).toEqual([operation, operation]);
		const attempts = f.requests.map(request => new Headers(request.init.headers).get("X-Readplace-Auth-Attempt-Id"));
		expect(new Set(attempts).size).toBe(2);
	});

	it("concurrent worker contexts adopt one durable operation and cannot overwrite the committed child", async () => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		let child: Response | undefined;
		f.answer(async (_url, init) => {
			if (!child) { child = f.issued(init); arrived.resolve(); return release.promise; }
			return child.clone();
		});
		const first = await initRecoverableOAuthAuth(f.deps);
		const firstRefresh = first.refreshTokens({ refusedAccessToken: "A0" }); await arrived.promise;
		const second = await initRecoverableOAuthAuth({ ...f.deps, contextId: crypto.randomUUID() });
		await second.refreshTokens({ refusedAccessToken: "A0" });
		assert(child); release.resolve(child.clone()); await firstRefresh;
		expect(new Set(f.requests.map(request => new URLSearchParams(String(request.init.body)).get("readplace_refresh_operation_id"))).size).toBe(1);
		expect(await first.getAccessToken()).toBe("A1"); expect(await second.getAccessToken()).toBe("A1");
	});

	it("a cancelled login preserves recovery of an already rotated predecessor", async () => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		let child: Response | undefined;
		f.answer(async (_url, init) => { child ??= f.issued(init); arrived.resolve(); return (await release.promise).clone(); });
		const auth = await initRecoverableOAuthAuth(f.deps);
		const refreshing = auth.refreshTokens({ refusedAccessToken: "A0" }); await arrived.promise;
		f.callback("https://readplace.test/oauth/callback?error=cancelled");
		await expect(auth.login()).rejects.toThrow("callback invalid");
		assert(child); release.resolve(child.clone()); await refreshing;
		const operation = (await f.store.read()).pending?.id;
		await auth.refreshTokens({ refusedAccessToken: "A0" });
		expect(new URLSearchParams(String(f.requests[1].init.body)).get("readplace_refresh_operation_id")).toBe(operation);
		expect(await auth.getAccessToken()).toBe("A1");
	});

	it.each(["nonce_required", "proof_replayed"])("re-signs %s without changing the logical operation", async reason => {
		const f = await fixture();
		let calls = 0;
		f.answer(async (_url, init) => ++calls === 1 ? json({ error: reason === "nonce_required" ? "use_dpop_nonce" : "invalid_dpop_proof", readplace_reason: reason }, 400, { "DPoP-Nonce": "challenge" }) : f.issued(init));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: true });
		const claims = f.requests.map(request => { const proof = new Headers(request.init.headers).get("DPoP"); assert(proof); return JSON.parse(Buffer.from(proof.split(".")[1], "base64url").toString()); });
		expect(claims[1].nonce).toBe("challenge");
		expect(claims[0].readplace_operation_id).toBe(claims[1].readplace_operation_id);
		expect(new Set(claims.map(item => item.jti)).size).toBe(2);
	});

	it.each([400, 429, 503])("preserves credentials and operation after unclassified HTTP %s", async status => {
		const f = await fixture(); f.answer(async () => json({ error: "unexpected" }, status));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		expect(await auth.getAccessToken()).toBe("A0");
		expect((await f.store.read()).pending?.protocol).toBe(true);
	});

	it.each(["expired", "revoked", "superseded"])("clears only a definitive matching-generation %s refusal", async reason => {
		const f = await fixture(); f.answer(async () => json({ error: "invalid_grant", readplace_reason: reason }, 400));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "refresh-failed" });
		expect(await auth.getAccessToken()).toBeNull();
		expect(auth.whenLoggedIn(() => 1)).toEqual({ ok: false, reason: "not-logged-in" });
		await expect(auth.resourceRejected("A0")).resolves.toBeUndefined();
	});

	it("retains the operation when replacement persistence fails", async () => {
		const f = await fixture(); f.failCommit(true);
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		const pending = (await f.store.read()).pending?.id;
		f.failCommit(false);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: true });
		expect(new URLSearchParams(String(f.requests[1].init.body)).get("readplace_refresh_operation_id")).toBe(pending);
	});

	it("commits an expired recovered child before rotating that child", async () => {
		const f = await fixture(); let calls = 0;
		f.answer(async (_url, init) => f.issued(init, { recovered: calls++ === 0, expired: calls === 1 }));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: true });
		expect(f.requests.map(request => new URLSearchParams(String(request.init.body)).get("refresh_token"))).toEqual(["R0", "R1"]);
		expect(new Set(f.requests.map(request => new URLSearchParams(String(request.init.body)).get("readplace_refresh_operation_id"))).size).toBe(2);
	});

	it.each([200, 400])("a delayed refresh HTTP%s cannot overwrite or clear a newer login", async status => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		await f.store.update(state => { state.permit = "old-permit"; });
		f.answer(async (_url, init) => {
			if (new URLSearchParams(String(init.body)).get("grant_type") === "authorization_code") return json({ access_token: "new-login", refresh_token: "new-login-refresh", diagnostics_permit: "new-permit" });
			arrived.resolve(); return release.promise;
		});
		const auth = await initRecoverableOAuthAuth(f.deps);
		const pending = auth.refreshTokens({ refusedAccessToken: "A0" }); await arrived.promise;
		const operation = (await f.store.read()).pending?.id;
		await auth.login();
		release.resolve(status === 200 ? f.issued(f.requests[0].init) : json({ error: "invalid_grant", readplace_reason: "revoked" }, 400));
		await pending;
		expect(await auth.getAccessToken()).toBe("new-login");
		expect((await f.store.read()).journal.filter(entry => entry.event.operation_id === operation).every(entry => entry.permit === "old-permit")).toBe(true);
	});

	it("does not attach late anonymous refresh evidence to a later account", async () => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		f.answer(async (_url, init) => {
			if (new URLSearchParams(String(init.body)).get("grant_type") === "authorization_code") return json({ access_token: "new", refresh_token: "new", diagnostics_permit: "new-permit" });
			arrived.resolve(); return release.promise;
		});
		const auth = await initRecoverableOAuthAuth(f.deps);
		const pending = auth.refreshTokens({ refusedAccessToken: "A0" }); await arrived.promise;
		const operation = (await f.store.read()).pending?.id;
		await auth.login(); release.resolve(f.issued(f.requests[0].init)); await pending;
		expect((await f.store.read()).journal.filter(entry => entry.event.operation_id === operation).every(entry => entry.permit === undefined)).toBe(true);
	});

	it.each(["revoke", "auth/session"])("keeps late %s diagnostics with their original account", async path => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		await f.store.update(state => { state.permit = "old-permit"; });
		f.answer(async url => {
			if (url.endsWith(path)) { arrived.resolve(); return release.promise; }
			return json({ access_token: "new", refresh_token: "new", diagnostics_permit: "new-permit" });
		});
		const auth = await initRecoverableOAuthAuth(f.deps);
		const pending = path === "revoke" ? auth.logout() : auth.ensureWebSession(); await arrived.promise;
		await auth.login(); release.resolve(json({})); await pending;
		const event = path === "revoke" ? "logout_completed" : "session_bridge_completed";
		expect((await f.store.read()).journal.find(entry => entry.event.event === event)?.permit).toBe("old-permit");
		expect(await auth.getAccessToken()).toBe("new");
	});

	it("logout fences a pending refresh and signs revocation of its predecessor", async () => {
		const f = await fixture(); const arrived = deferred<void>(); const release = deferred<Response>();
		f.answer(async (url) => { if (url.endsWith("/revoke")) return json({}); arrived.resolve(); return release.promise; });
		const auth = await initRecoverableOAuthAuth(f.deps);
		const pending = auth.refreshTokens({ refusedAccessToken: "A0" }); await arrived.promise;
		await auth.logout(); release.resolve(f.issued(f.requests[0].init)); await pending;
		expect(await auth.getAccessToken()).toBeNull();
		expect(JSON.parse(String(f.requests[1].init.body))).toMatchObject({ token: "R0", readplace_refresh_protocol: 1 });
		expect(new Headers(f.requests[1].init.headers).get("DPoP")?.split(".")).toHaveLength(3);
	});

	it("resource refusals preserve credentials, and the bridge reports its own outcome", async () => {
		const f = await fixture(); const auth = await initRecoverableOAuthAuth(f.deps);
		await auth.reportLoginPrompt();
		expect((await f.store.read()).journal.some(entry => entry.event.event === "login_prompt_shown" && entry.event.surface === "popup")).toBe(true);
		await expect(auth.resourceRejected("A0")).rejects.toThrow("Please try again");
		await expect(auth.resourceRejected("older-token")).rejects.toThrow("Please try again");
		await auth.ensureWebSession();
		expect(await auth.getAccessToken()).toBe("A0");
		expect(f.requests[0].init.credentials).toBe("include");
		expect(auth.whenLoggedIn(() => "ready")).toEqual({ ok: true, value: "ready" });
		expect(auth.whenLoggedIn(() => { throw "failed"; })).toMatchObject({ ok: false, reason: "error" });
		expect(auth.whenLoggedIn(() => { throw new Error("failed"); })).toMatchObject({ ok: false, reason: "error" });
	});

	it("does not enroll when discovery disables the protocol", async () => {
		const f = await fixture(); f.metadata(json({ readplace_refresh_enrollment_enabled: false }));
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.refreshTokens({ refusedAccessToken: "A0" });
		expect(new Headers(f.requests[0].init.headers).get("DPoP")).toBeNull();
		expect((await f.store.read()).credentials?.bound).toBe(false);
	});

	it("repairs an expired website bridge with the same recoverable refresh and one replay", async () => {
		const f = await fixture(); let bridgeCalls = 0;
		f.answer(async (url, init) => url.endsWith("/auth/session") ? json({}, ++bridgeCalls === 1 ? 401 : 200) : f.issued(init));
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.ensureWebSession();
		expect(f.requests.map(request => new URL(request.url).pathname)).toEqual(["/auth/session", "/oauth/token", "/auth/session"]);
		expect(new Headers(f.requests[2].init.headers).get("Authorization")).toBe("Bearer A1");
		expect((await f.store.read()).journal.some(entry => entry.event.event === "session_bridge_completed" && entry.event.outcome === "success")).toBe(true);
	});

	it("keeps an inconclusive website bridge failure from clearing the extension login", async () => {
		const f = await fixture(); f.answer(async url => json({}, url.endsWith("/auth/session") ? 401 : 503));
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.ensureWebSession();
		expect(await auth.getAccessToken()).toBe("A0"); expect(f.requests).toHaveLength(2);
	});

	it.each(["?error=denied", "?state=wrong", "?code=c&state=wrong"])("rejects invalid callbacks %s without committing credentials", async query => {
		const f = await fixture(); f.callback(`https://readplace.test/oauth/callback${query}`);
		const auth = await initRecoverableOAuthAuth(f.deps);
		await expect(auth.login()).rejects.toThrow("callback invalid");
		expect(await auth.getAccessToken()).toBe("A0");
	});

	it.each([404, 503])("handles discovery HTTP%s without prematurely losing the legacy login", async status => {
		const f = await fixture(); f.metadata(json({}, status));
		const auth = await initRecoverableOAuthAuth(f.deps);
		const result = await auth.refreshTokens({ refusedAccessToken: "A0" });
		expect(result.ok).toBe(status === 404);
		expect((await f.store.read()).credentials?.bound).toBe(false);
	});

	it.each(["network", "timeout"])("retains the prepared operation after a %s error", async kind => {
		const f = await fixture(); f.answer(async () => { const error = new Error("private transport details"); if (kind === "timeout") error.name = "TimeoutError"; throw error; });
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		expect((await f.store.read()).journal.some(entry => entry.event.reason === (kind === "timeout" ? "timeout" : "network_error"))).toBe(true);
	});

	it.each([undefined, "unknown"])("treats bound invalid_grant reason %s as inconclusive", async reason => {
		const f = await fixture(); f.answer(async () => json({ error: "invalid_grant", readplace_reason: reason }, 400));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
	});

	it("legacy invalid_grant clears the old login but never attempts empty refresh or bridge requests", async () => {
		const f = await fixture(); f.metadata(json({})); f.answer(async () => json({ error: "invalid_grant" }, 400));
		const auth = await initRecoverableOAuthAuth(f.deps);
		await auth.refreshTokens({ refusedAccessToken: "A0" });
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "no-refresh-token" });
		await auth.ensureWebSession(); await auth.logout();
		expect(f.requests).toHaveLength(1);
	});

	it("does not spin indefinitely on nonce challenges", async () => {
		const f = await fixture(); f.answer(async () => json({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "again" }));
		const auth = await initRecoverableOAuthAuth(f.deps);
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: false, reason: "unavailable" });
		expect(f.requests).toHaveLength(3);
	});

	it("keeps a newer credential that arrives during an outer storage read", async () => {
		const f = await fixture(); const auth = await initRecoverableOAuthAuth(f.deps);
		const read = f.store.read; let first = true;
		f.store.read = async () => {
			const snapshot = await read();
			if (first) { first = false; await f.store.update(state => { state.credentials = { accessToken: "other", refreshToken: "other-refresh", bound: false }; }); }
			return snapshot;
		};
		expect(await auth.refreshTokens({ refusedAccessToken: "A0" })).toEqual({ ok: true });
		expect(f.requests).toHaveLength(0);
	});

	it("does not allocate an old operation after a concurrent sign-in completes during discovery", async () => {
		const f = await fixture(); const discovery = deferred<Response>(); const readStarted = deferred<void>();
		const fetchFn = f.deps.fetchFn;
		f.deps.fetchFn = async (url, init) => String(url).includes(".well-known") ? discovery.promise : fetchFn(url, init);
		const auth = await initRecoverableOAuthAuth(f.deps);
		const read = f.store.read; let reads = 0;
		f.store.read = async () => { const snapshot = await read(); if (++reads === 2) readStarted.resolve(); return snapshot; };
		const refresh = auth.refreshTokens({ refusedAccessToken: "A0" }); await readStarted.promise;
		await f.store.update(state => { state.epoch = crypto.randomUUID(); state.credentials = { accessToken: "new", refreshToken: "new", bound: false }; });
		discovery.resolve(json({ readplace_refresh_protocols_supported: [1], readplace_refresh_enrollment_enabled: true }));
		expect(await refresh).toEqual({ ok: true }); expect(f.requests).toHaveLength(0);
	});

	it("fences competing code exchanges and reports code refusals", async () => {
		const f = await fixture(); const first = deferred<Response>(); const arrived = deferred<void>(); let calls = 0;
		f.answer(async () => { if (++calls === 1) { arrived.resolve(); return first.promise; } return json({ access_token: "second", refresh_token: "second", diagnostics_permit: "new-permit" }); });
		const auth = await initRecoverableOAuthAuth(f.deps);
		const login = auth.login(); await arrived.promise; await auth.login(); first.resolve(json({ access_token: "first", refresh_token: "first" }));
		await expect(login).rejects.toThrow("session changed"); expect(await auth.getAccessToken()).toBe("second");
		f.answer(async () => json({}, 400)); await expect(auth.login()).rejects.toThrow("code exchange failed");
	});

	it("preserves the login when its website bridge fails and tolerates offline explicit revocation", async () => {
		const f = await fixture(); f.metadata(json({})); f.answer(async url => { if (url.endsWith("/auth/session")) return json({}, 401); throw new Error("offline"); });
		const auth = await initRecoverableOAuthAuth(f.deps); await auth.ensureWebSession(); await auth.logout();
		expect(await auth.getAccessToken()).toBeNull();
		expect(JSON.parse(String(f.requests.find(request => request.url.endsWith("/revoke"))?.init.body))).toEqual({ token: "R0", client_id: "hutch-chrome-extension" });
	});
});
