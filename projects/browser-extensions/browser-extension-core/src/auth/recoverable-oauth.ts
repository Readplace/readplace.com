import { z } from "zod";
import type { AuthDiagnosticEvent } from "@packages/domain/auth-diagnostics";
import type { Auth, OAuthAuthDeps, RefreshResult, WhenLoggedIn } from "./auth.types";
import type { AuthState, AuthStateStore, PendingRefresh } from "./auth-state.types";
import { initAuthJournal } from "./auth-journal";
import type { initRefreshProof } from "./refresh-proof";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce";

const Issued = z.object({
	access_token: z.string().min(1), refresh_token: z.string().min(1),
	readplace: z.object({
		protocol: z.literal(1), operation_id: z.uuid(), grant_id: z.string().min(1), generation: z.number().int().nonnegative(),
		access_expires_at: z.iso.datetime({ offset: true }), refresh_expires_at: z.iso.datetime({ offset: true }),
		recovered: z.boolean(), diagnostics_permit: z.string().optional(),
	}).optional(),
	diagnostics_permit: z.string().optional(),
});
const Refusal = z.object({ error: z.string(), readplace_reason: z.string().optional() });
const Discovery = z.object({
	readplace_refresh_protocols_supported: z.array(z.number()).optional(),
	readplace_refresh_enrollment_enabled: z.boolean().optional(),
	readplace_auth_diagnostics_endpoint: z.url().optional(),
});

type Deps = Omit<OAuthAuthDeps, "fetchFn" | "tokenStorage"> & {
	store: AuthStateStore;
	proof: ReturnType<typeof initRefreshProof>;
	fetchFn: typeof fetch;
	client: "chrome" | "firefox";
	version: string;
	contextId: string;
	now: () => number;
	uuid: () => string;
	keepAlive: <T>(work: Promise<T>) => Promise<T>;
};
type RequestOwner = Pick<AuthState, "epoch" | "permit" | "installationId" | "key">;

export async function initRecoverableOAuthAuth(deps: Deps): Promise<Auth & {
	resourceRejected: (accessToken: string) => Promise<void>;
	reportLoginPrompt: () => Promise<void>;
	flushDiagnostics: () => Promise<void>;
}> {
	const journal = initAuthJournal(deps);
	let loggedIn = (await deps.store.read()).credentials !== null;
	let enrollment: Promise<boolean> | undefined;
	let refreshing: Promise<RefreshResult> | undefined;

	function headers(state: { installationId: string }, attemptId: string): Record<string, string> {
		return {
			"X-Readplace-Auth-Attempt-Id": attemptId, "X-Readplace-Auth-Context-Id": deps.contextId,
			"X-Readplace-Client-Version": deps.version, "X-Readplace-Installation-Id": state.installationId,
		};
	}
	async function discover(): Promise<boolean> {
		const response = await deps.fetchFn(`${deps.serverUrl}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(20_000) });
		if (response.status === 404) return false;
		if (!response.ok) throw new Error("OAuth discovery unavailable");
		const metadata = Discovery.parse(await response.json());
		const endpoint = metadata.readplace_auth_diagnostics_endpoint;
		if (endpoint && new URL(endpoint).origin === new URL(deps.serverUrl).origin) {
			await deps.store.update(state => { state.diagnosticsEndpoint = endpoint; });
		}
		return metadata.readplace_refresh_enrollment_enabled === true && metadata.readplace_refresh_protocols_supported?.includes(1) === true;
	}
	function enroll(): Promise<boolean> {
		enrollment ??= discover().catch(error => { enrollment = undefined; throw error; });
		return enrollment;
	}

	async function send(input: { body: string; operation: PendingRefresh; owner: RequestOwner; path: "token" | "revoke" }): Promise<Response> {
		let nonce: string | undefined;
		for (let challenge = 0; ; challenge++) {
			const attemptId = deps.uuid();
			const started = deps.now();
			const url = `${deps.serverUrl}/oauth/${input.path}`;
			const requestHeaders = { ...headers(input.owner, attemptId), "Content-Type": input.path === "token" ? "application/x-www-form-urlencoded" : "application/json" };
			if (input.operation.protocol) {
				Object.assign(requestHeaders, { DPoP: await deps.proof.sign({ key: input.owner.key, url, body: input.body, operationId: input.operation.id, nonce }) });
			}
			await journal.write({ event: "refresh_request_started", operation_id: input.operation.id, attempt_id: attemptId }, input.owner);
			let response: Response;
			try {
				response = await deps.fetchFn(url, { method: "POST", headers: requestHeaders, body: input.body, signal: AbortSignal.timeout(20_000) });
			} catch (error) {
				await journal.write({ event: "refresh_failed", operation_id: input.operation.id, attempt_id: attemptId, reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error", outcome: "preserved" }, input.owner);
				throw error;
			}
			await journal.write({ event: "refresh_response_received", operation_id: input.operation.id, attempt_id: attemptId, http_status: response.status, duration_ms: Math.max(0, deps.now() - started) }, input.owner);
			const nextNonce = response.headers.get("DPoP-Nonce");
			if (input.operation.protocol && response.status === 400 && nextNonce && challenge < 2) {
				const body = Refusal.safeParse(await response.clone().json().catch(() => null));
				if (body.success && (body.data.error === "use_dpop_nonce" || body.data.readplace_reason === "proof_replayed")) {
					nonce = nextNonce;
					continue;
				}
			}
			return response;
		}
	}

	async function exchange(refusedAccessToken: string): Promise<RefreshResult> {
		const before = await deps.store.read();
		if (!before.credentials) return { ok: false, reason: "no-refresh-token" };
		if (before.credentials.accessToken !== refusedAccessToken) return { ok: true };
		const protocol = before.pending?.protocol ?? (before.credentials.bound || await enroll());
		const prepared = await deps.store.update(state => {
			if (state.epoch !== before.epoch || state.credentials?.accessToken !== refusedAccessToken) return null;
			state.pending ??= { id: deps.uuid(), epoch: state.epoch, protocol };
			journal.record(state, { event: "refresh_prepared", operation_id: state.pending.id, generation: state.credentials.generation });
			return { operation: state.pending, credentials: state.credentials, owner: { epoch: state.epoch, permit: state.permit, installationId: state.installationId, key: state.key } };
		});
		if (!prepared) return { ok: true };
		const { operation, credentials, owner } = prepared;
		const fields: Record<string, string> = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: deps.clientId };
		if (operation.protocol) Object.assign(fields, { readplace_refresh_protocol: "1", readplace_refresh_operation_id: operation.id });
		const response = await send({ body: new URLSearchParams(fields).toString(), operation, owner, path: "token" });
		const body: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const refusal = Refusal.safeParse(body);
			const terminalReason = (["expired", "revoked", "superseded"] as const).find(reason => refusal.success && refusal.data.readplace_reason === reason);
			const terminal = response.status === 400 && refusal.success && refusal.data.error === "invalid_grant" &&
				(!operation.protocol || terminalReason !== undefined);
			if (terminal) {
				const cleared = await deps.store.update(state => {
					if (state.epoch !== operation.epoch || state.pending?.id !== operation.id || state.credentials?.accessToken !== refusedAccessToken) return false;
					state.credentials = null; state.pending = null; state.epoch = deps.uuid();
					journal.record(state, { event: "credentials_cleared", operation_id: operation.id, reason: terminalReason ?? "refresh_rejected", outcome: "failure" }, owner);
					return true;
				});
				if (!cleared) return { ok: true };
				loggedIn = false;
				return { ok: false, reason: "refresh-failed" };
			}
			await journal.write({ event: "refresh_failed", operation_id: operation.id, http_status: response.status, reason: "http_error", outcome: "preserved" }, owner);
			return { ok: false, reason: "unavailable" };
		}
		const issued = Issued.safeParse(body);
		if (!issued.success || (operation.protocol && issued.data.readplace?.operation_id !== operation.id)) {
			await journal.write({ event: "refresh_failed", operation_id: operation.id, reason: "malformed_response", outcome: "preserved" }, owner);
			return { ok: false, reason: "unavailable" };
		}
		const metadata = issued.data.readplace;
		await journal.write({ event: "refresh_parsed", operation_id: operation.id }, owner);
		await journal.write({ event: "storage_started", operation_id: operation.id }, owner);
		const stored = await deps.store.update(state => {
			if (state.epoch !== operation.epoch || state.pending?.id !== operation.id || state.credentials?.accessToken !== refusedAccessToken) return false;
			state.credentials = {
				accessToken: issued.data.access_token, refreshToken: issued.data.refresh_token, bound: operation.protocol,
				grantId: metadata?.grant_id, generation: metadata?.generation, accessExpiresAt: metadata?.access_expires_at,
			};
			state.pending = null;
			state.permit = metadata?.diagnostics_permit ?? issued.data.diagnostics_permit ?? state.permit;
			for (const entry of state.journal) if (entry.epoch === state.epoch) entry.permit ??= state.permit;
			journal.record(state, { event: "storage_completed", operation_id: operation.id, generation: metadata?.generation, outcome: "success" });
			journal.record(state, { event: metadata?.recovered ? "refresh_recovered" : "refresh_completed", operation_id: operation.id, generation: metadata?.generation, outcome: metadata?.recovered ? "recovered" : "success" });
			return true;
		}).catch(async error => {
			await journal.write({ event: "storage_failed", operation_id: operation.id, reason: "storage_write_failed", outcome: "preserved" }, owner).catch(() => {});
			throw error;
		});
		if (stored) loggedIn = true;
		return { ok: true };
	}
	async function runRefresh(refusedAccessToken: string, owner: RequestOwner): Promise<RefreshResult> {
		try {
			const result = await exchange(refusedAccessToken);
			const current = await deps.store.read();
			if (result.ok && current.credentials?.accessExpiresAt && Date.parse(current.credentials.accessExpiresAt) <= deps.now()) {
				return await exchange(current.credentials.accessToken);
			}
			return result;
		} catch {
			await journal.write({ event: "refresh_failed", reason: "unknown", outcome: "preserved" }, owner).catch(() => {});
			return { ok: false, reason: "unavailable" };
		}
	}
	const refreshTokens: Auth["refreshTokens"] = async refused => {
		const current = await deps.store.read();
		if (current.credentials && current.credentials.accessToken !== refused.refusedAccessToken) return { ok: true };
		refreshing ??= deps.keepAlive(runRefresh(refused.refusedAccessToken, current)).finally(() => { refreshing = undefined; void journal.flush(); });
		return refreshing;
	};
	const getAccessToken = async () => (await deps.store.read()).credentials?.accessToken ?? null;

	async function login(): Promise<{ ok: true }> {
		const epoch = deps.uuid();
		const owner = await deps.store.update(state => {
			state.epoch = epoch; if (state.pending) state.pending = { ...state.pending, epoch };
			journal.record(state, { event: "login_started" });
			return { epoch, permit: state.permit, installationId: state.installationId };
		});
		const verifier = generateCodeVerifier();
		const stateValue = generateCodeVerifier();
		const redirectUri = `${deps.serverUrl}/oauth/callback`;
		const authorize = new URL(`${deps.serverUrl}/oauth/authorize`);
		authorize.search = new URLSearchParams({ client_id: deps.clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: await generateCodeChallenge(verifier), code_challenge_method: "S256", state: stateValue }).toString();
		let reason: AuthDiagnosticEvent["reason"] = "callback_invalid";
		try {
			const tabId = await deps.openTab(authorize.toString());
			const redirect = await deps.waitForRedirect({ tabId, urlPrefix: redirectUri });
			await deps.closeTab(tabId);
			const callback = new URL(redirect);
			const code = callback.searchParams.get("code");
			if (callback.searchParams.get("error")) { reason = "provider_rejected"; throw new Error("OAuth callback invalid"); }
			if (!code || callback.searchParams.get("state") !== stateValue) throw new Error("OAuth callback invalid");
			await journal.write({ event: "login_callback_received" }, owner);
			reason = "network_error";
			const response = await deps.fetchFn(`${deps.serverUrl}/oauth/token`, {
				method: "POST", headers: { ...headers(owner, deps.uuid()), "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: deps.clientId, code_verifier: verifier }).toString(),
				signal: AbortSignal.timeout(20_000),
			});
			if (!response.ok) { reason = "http_error"; throw new Error("OAuth code exchange failed"); }
			reason = "malformed_response";
			const tokens = Issued.parse(await response.json());
			reason = "storage_write_failed";
			const committed = await deps.store.update(state => {
				if (state.epoch !== epoch) return false;
				state.credentials = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, bound: false };
				state.pending = null;
				state.permit = tokens.diagnostics_permit ?? tokens.readplace?.diagnostics_permit;
				for (const entry of state.journal) if (entry.epoch === epoch) entry.permit ??= state.permit;
				journal.record(state, { event: "login_completed", outcome: "success" });
				return true;
			});
			if (!committed) { reason = "newer_generation"; throw new Error("OAuth session changed"); }
			loggedIn = true;
			void enroll().then(() => journal.flush()).catch(() => {});
			return { ok: true };
		} catch (error) {
			await journal.write({ event: "login_failed", reason, outcome: "failure" }, owner);
			throw error;
		}
	}

	async function logout(): Promise<void> {
		const previous = await deps.store.update(state => {
			journal.record(state, { event: "logout_started", reason: "user_requested" });
			const owner = { epoch: state.epoch, permit: state.permit, key: state.key, installationId: state.installationId };
			const result = { credentials: state.credentials, protocol: state.credentials?.bound === true || state.pending?.protocol === true, owner };
			state.credentials = null; state.pending = null; state.epoch = deps.uuid();
			journal.record(state, { event: "credentials_cleared", reason: "user_requested", outcome: "success" }, owner);
			return result;
		});
		loggedIn = false;
		if (previous.credentials) {
			const operation: PendingRefresh = { id: deps.uuid(), epoch: deps.uuid(), protocol: previous.protocol };
			const body = JSON.stringify({ token: previous.credentials.refreshToken, client_id: deps.clientId,
				...(operation.protocol ? { readplace_refresh_protocol: 1, readplace_refresh_operation_id: operation.id } : {}),
			});
			await send({ body, operation, owner: previous.owner, path: "revoke" }).catch(() => {});
		}
		await journal.write({ event: "logout_completed", outcome: "success" }, previous.owner);
		void journal.flush();
	}
	const whenLoggedIn: WhenLoggedIn = fn => {
		if (!loggedIn) return { ok: false, reason: "not-logged-in" };
		try { return { ok: true, value: fn() }; }
		catch (error) { return { ok: false, reason: "error", error: error instanceof Error ? error : new Error(String(error)) }; }
	};
	await journal.write({ event: "context_started" });
	const restored = await deps.store.read();
	await journal.write({ event: "storage_read", generation: restored.credentials?.generation, outcome: "success" });
	if (restored.pending && restored.credentials) void refreshTokens({ refusedAccessToken: restored.credentials.accessToken });
	void enroll().then(() => journal.flush()).catch(() => {});
	return {
		login, logout, refreshTokens, getAccessToken, whenLoggedIn,
		reportLoginPrompt: () => journal.write({ event: "login_prompt_shown", surface: "popup" }),
		async resourceRejected(accessToken) {
			const current = await deps.store.read();
			if (current.credentials) {
				const matching = current.credentials.accessToken === accessToken;
				await journal.write({ event: "refresh_failed", reason: matching ? "http_error" : "newer_generation", outcome: "preserved" }, matching ? current : { epoch: deps.uuid() });
				throw new Error("Could not verify the session. Please try again.");
			}
		},
		async ensureWebSession() {
			let owner = await deps.store.read();
			const token = owner.credentials?.accessToken;
			if (!token) return;
			const bridge = async (accessToken: string) => deps.fetchFn(`${deps.serverUrl}/auth/session`, {
				method: "POST", headers: { ...headers(owner, deps.uuid()), Authorization: `Bearer ${accessToken}` },
				credentials: "include", signal: AbortSignal.timeout(20_000),
			});
			let response = await bridge(token);
			if (response.status === 401) {
				const result = await refreshTokens({ refusedAccessToken: token });
				const replacement = await deps.store.read();
				if (result.ok && replacement.credentials) { owner = replacement; response = await bridge(replacement.credentials.accessToken); }
			}
			await journal.write({ event: "session_bridge_completed", http_status: response.status, outcome: response.ok ? "success" : "failure" }, owner);
		},
		flushDiagnostics: journal.flush,
	};
}
