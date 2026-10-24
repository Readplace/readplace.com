import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { UserIdSchema } from "@packages/domain/user";
import { initAuthDiagnosticMiddleware } from "./middleware";
import { authDiagnosticContext, initAuthDiagnosticRecorder } from "./record";
import { buildAuthDiagnosticsDashboard } from "./dashboard";

const at = new Date("2026-10-16T00:00:00Z");

function create() {
	const events: Record<string, unknown>[] = [];
	const capture = (event: Record<string, unknown>) => { events.push(event); };
	const diagnostics = initAuthDiagnosticRecorder({ salt: "test-only", now: () => at,
		logger: { info: capture, error: capture, warn: capture, debug: capture } });
	const app = express().use(express.urlencoded({ extended: false })).use(express.json()).use(cookieParser())
		.use(initAuthDiagnosticMiddleware({ diagnostics, now: () => at, secureCookies: false }));
	return { app, events, diagnostics };
}

describe("authentication request diagnostics", () => {
	it("attributes an initial PKCE exchange using its upload permit without recording the permit", async () => {
		const { app, events, diagnostics } = create();
		const permit = diagnostics.permits.issue({ userId: "private-user", grantId: "new-grant", client: "ios", installationId: randomUUID() });
		app.post("/oauth/token", (_req, res) => res.json({ access_token: "private-access", diagnostics_permit: permit }));
		await request(app).post("/oauth/token").send({ client_id: "ios-app", grant_type: "authorization_code", code: "private-code" });
		expect(events[0]).toMatchObject({ event: "oauth_exchange_finished", outcome: "success", grant_id: "new-grant", subject_ref: diagnostics.permits.reference({ kind: "subject", value: "private-user" }) });
		expect(JSON.stringify(events).includes("private-")).toBe(false);
		expect(JSON.stringify(events).includes(permit)).toBe(false);
	});
	it("correlates server arrivals with one application attempt and keeps response credentials out of events", async () => {
		const { app, events, diagnostics } = create();
		const operation = randomUUID();
		const attempt = randomUUID();
		const context = randomUUID();
		const installation = randomUUID();
		const permit = diagnostics.permits.issue({ userId: "private-user", grantId: "grant", client: "chrome", installationId: installation });
		app.post("/oauth/token", (_req, res) => res.json({ access_token: "private-access", refresh_token: "private-refresh", readplace: {
			grant_id: "grant", generation: 2, recovered: true, diagnostics_permit: permit,
		} }));
		for (let i = 0; i < 2; i++) {
			await request(app).post("/oauth/token").set("X-Readplace-Auth-Attempt-Id", attempt)
				.set("X-Readplace-Auth-Context-Id", context).set("X-Readplace-Client-Version", "1.0.680")
				.set("X-Readplace-Installation-Id", installation)
				.send({ client_id: "hutch-chrome-extension", readplace_refresh_operation_id: operation, refresh_token: "private-refresh" });
		}
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ event: "oauth_exchange_finished", source: "server", outcome: "success", client: "chrome", surface: "background",
			operation_id: operation, attempt_id: attempt, context_id: context, installation_ref: installation, generation: 2, recovered: true,
			subject_ref: diagnostics.permits.reference({ kind: "subject", value: "private-user" }), grant_id: "grant" });
		expect(new Set(events.map(event => event.request_id)).size).toBe(2);
		expect(JSON.stringify(events).includes("private-")).toBe(false);
		expect(JSON.stringify(events).includes(permit)).toBe(false);
	});

	it.each([
		["ios-app", "ios", "app"], ["android-app", "android", "app"],
		["hutch-firefox-extension", "firefox", "background"], ["registered-third-party", "external", "external"],
	])("classifies %s without logging the supplied client identifier", async (clientId, client, surface) => {
		const { app, events } = create();
		app.post("/oauth/token", (_req, res) => res.status(400).json({ error: "invalid_grant", readplace_reason: "revoked" }));
		await request(app).post("/oauth/token").send({ client_id: clientId });
		expect(events).toEqual([expect.objectContaining({ event: "oauth_exchange_finished", client, surface, reason: "revoked", outcome: "failure" })]);
	});

	it("recognizes nonce challenges and treats malformed error bodies as unknown", async () => {
		for (const body of [{ error: "use_dpop_nonce" }, { error: 42 }]) {
			const { app, events } = create();
			app.post("/oauth/token", (_req, res) => res.status(400).json(body));
			await request(app).post("/oauth/token").send({});
			expect(events[0].reason).toBe(body.error === "use_dpop_nonce" ? "nonce_required" : "unknown");
		}
	});

	it("retains the login flow across navigation and distinguishes a failed callback redirect from login success", async () => {
		const { app, events } = create();
		app.get("/login", (_req, res) => res.send("login"));
		app.get("/auth/google", (_req, res) => res.redirect("/provider"));
		app.get("/auth/google/callback", (_req, res) => res.redirect("/login"));
		const agent = request.agent(app);
		await agent.get("/login");
		await agent.get("/auth/google");
		await agent.get("/auth/google/callback");
		expect(events.map(event => event.event)).toEqual(["session_unavailable", "login_prompt_shown", "session_unavailable", "login_started", "session_unavailable", "login_callback_received", "login_finished"]);
		expect(new Set(events.map(event => event.context_id)).size).toBe(1);
		expect(events.at(-1)?.outcome).toBe("failure");
	});

	it("records completed login without exposing its issued session cookie", async () => {
		const { app, events } = create();
		app.post("/login", (_req, res) => res.cookie("hutch_sid", "private-cookie").redirect("/queue"));
		await request(app).post("/login").set("Cookie", "hutch_sid=previous").send({});
		expect(events.map(event => event.event)).toEqual(["login_started", "login_finished"]);
		expect(events[1].outcome).toBe("success");
	});

	it.each(["user_cancelled", "callback_invalid", "expired", "provider_rejected", "unapproved-private-detail"])("records a validated callback outcome: %s", async reason => {
		const { app, events } = create();
		app.post("/auth/apple/callback", (_req, res) => { res.locals.authDiagnosticReason = reason; res.redirect(303, "/login"); });
		await request(app).post("/auth/apple/callback").send({});
		expect(events.at(-1)).toMatchObject({ event: "login_finished", reason: reason === "unapproved-private-detail" ? "login" : reason, outcome: reason === "user_cancelled" ? "cancelled" : "failure" });
	});

	it.each([
		["/auth/session", "oauth_bridge", 204, "session_bridge_completed", "success"],
		["/auth/session", "oauth_bridge", 401, "session_bridge_completed", "failure"],
		["/logout", "web_logout", 303, "logout_completed", "success"],
		["/logout", "web_logout", 500, "logout_completed", "failure"],
		["/reset-password", "password_reset", 200, "session_deleted", undefined],
		["/account/password", "password_reset", 200, "session_deleted", undefined],
		["/account/delete", "account_deleted", 200, "session_deleted", undefined],
		["/oauth/revoke", "native_logout", 200, "session_deleted", undefined],
	])("links %s to session lifecycle cause %s", async (path, cause, status, event, outcome) => {
		const { app, events, diagnostics } = create();
		app.post(path, (_req, res) => {
			diagnostics.observeSession({ event: "session_deleted", sessionId: "private-cookie", userId: UserIdSchema.parse("private-user") });
			res.status(status).end();
		});
		await request(app).post(path).set("Cookie", "hutch_sid=private-cookie").send({});
		expect(events[0]).toMatchObject({ event: "session_deleted", reason: cause });
		expect(events.at(-1)).toMatchObject({ event, ...(outcome ? { outcome } : {}) });
	});

	it("records account switch and unrelated resource refusal without inventing a logout", async () => {
		const { app, events, diagnostics } = create();
		app.post("/oauth/authorize", (_req, res) => {
			diagnostics.observeSession({ event: "session_deleted", sessionId: "cookie" });
			res.status(303).end();
		});
		app.get("/queue", (_req, res) => res.status(401).end());
		app.post("/diagnostics/auth", (_req, res) => res.status(401).end());
		await request(app).post("/oauth/authorize").set("Cookie", "hutch_sid=cookie").send({ action: "switch" });
		await request(app).get("/queue");
		await request(app).post("/diagnostics/auth");
		expect(events.map(event => [event.event, event.reason])).toEqual([["session_deleted", "oauth_account_switch"], ["authentication_refused", "unknown"]]);
	});

	it.each(["/auth/session", "/queue"])("retains an authoritative credential refusal for %s", async path => {
		const { app, events } = create();
		app.post(path, (_req, res) => {
			const context = authDiagnosticContext.getStore();
			if (!context) throw new Error("request context missing");
			context.auth_refusal_reason = "expired";
			context.subject_ref = "verified-owner";
			res.status(401).end();
		});
		await request(app).post(path).set("Cookie", "hutch_sid=cookie").send({});
		expect(events.at(-1)).toMatchObject({ reason: "expired", subject_ref: "verified-owner", http_status: 401 });
	});

	it("can record outside an HTTP request and keeps diagnostics failure from changing authentication", () => {
		const { events, diagnostics } = create();
		diagnostics.observe({ event: "credential_revoked" });
		expect(events[0]).toMatchObject({ event: "credential_revoked", source: "server" });
		const fail = () => { throw new Error("logger unavailable"); };
		const health: unknown[] = [];
		const broken = initAuthDiagnosticRecorder({ salt: "test", now: () => at, logger: { info: fail, error: event => { health.push(event); }, warn: fail, debug: fail } });
		broken.observe({ event: "credential_revoked" });
		expect(health).toEqual([{ stream: "auth-diagnostics", event: "journal_health", source: "server", reason: "journal_unavailable" }]);
		initAuthDiagnosticRecorder({ salt: "test", now: () => at, logger: { info: fail, error: fail, warn: fail, debug: fail } }).observe({ event: "credential_revoked" });
		expect(authDiagnosticContext.getStore()).toBeUndefined();
	});
});

it("builds authentication investigation views scoped to the retained diagnostics stream", () => {
	const dashboard = JSON.parse(buildAuthDiagnosticsDashboard({ region: "ap-southeast-2", logGroupName: "/readplace/auth-diagnostics" }));
	expect(dashboard.widgets).toHaveLength(5);
	expect(dashboard.widgets.map((widget: { properties: { query: string } }) => widget.properties.query)).toEqual([
		expect.stringContaining("count_distinct(event_id)"), expect.stringContaining("latest(client_version) as last_client_version"), expect.stringContaining("count_distinct(request_id)"),
		expect.stringContaining("session_deleted"), expect.stringContaining("maximum_dropped"),
	]);
});
