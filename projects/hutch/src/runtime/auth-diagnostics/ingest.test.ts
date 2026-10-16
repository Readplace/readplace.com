import { createHmac, randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { initAuthDiagnosticPermits } from "./permit";
import { initIngestAuthDiagnostics } from "./ingest";

const at = new Date("2026-10-16T00:00:00Z");
const ownership = { userId: "account-private", grantId: "grant-1", client: "chrome" as const, installationId: randomUUID() };
const permits = initAuthDiagnosticPermits({ salt: "test-only-signing-secret", now: () => at });
const permit = permits.issue(ownership);
const checkpoint = {
	event_id: randomUUID(), event: "credentials_cleared", occurred_at: at.toISOString(),
	client: "chrome", surface: "background", context_id: randomUUID(), client_version: "1.0.680", reason: "revoked",
};

function create(overrides: { allowed?: boolean; record?: (event: Record<string, unknown>) => void } = {}) {
	const events: Record<string, unknown>[] = [];
	const app = express().use(express.json({ limit: "64kb" })).post("/diagnostics/auth", initIngestAuthDiagnostics({
		verifyPermit: permits.verify, now: () => at,
		consumeRateLimit: async () => overrides.allowed === false ? { allowed: false, retryAfterSeconds: 12 } : { allowed: true },
		record: overrides.record ?? (event => { events.push(event); }),
	}));
	const onError: ErrorRequestHandler = (_error, _req, res, _next) => { res.status(500).end(); };
	app.use(onError);
	return { app, events };
}

describe("authentication diagnostic upload", () => {
	it("accepts a post-logout checkpoint using its upload-only permit and derives ownership", async () => {
		const { app, events } = create();
		const response = await request(app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`)
			.send({ schema_version: 1, events: [checkpoint, checkpoint] });
		expect(response.status).toBe(202);
		expect(response.body).toEqual({ accepted_event_ids: [checkpoint.event_id] });
		expect(events).toEqual([{ ...checkpoint, source: "client", schema_version: 1, recorded_at: at.toISOString(),
			subject_ref: permits.reference({ kind: "subject", value: ownership.userId }), grant_id: "grant-1", installation_ref: ownership.installationId }]);
		expect(response.headers["cache-control"]).toBe("no-store");
	});

	it.each([undefined, "Basic secret", "Bearer forged"])("refuses unauthenticated ingestion (%s)", async authorization => {
		const { app, events } = create();
		const call = request(app).post("/diagnostics/auth");
		if (authorization) call.set("Authorization", authorization);
		expect((await call.send({ schema_version: 1, events: [checkpoint] })).status).toBe(401);
		expect(events).toEqual([]);
	});

	it.each([
		{ ...checkpoint, client: "ios" },
		{ ...checkpoint, refresh_token: "must-never-be-logged" },
		{ ...checkpoint, subject_ref: "forged-owner" },
	])("rejects foreign attribution or unapproved fields without logging the payload", async event => {
		const { app, events } = create();
		expect((await request(app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`).send({ schema_version: 1, events: [event] })).status).toBe(400);
		expect(events).toEqual([]);
	});

	it("rejects an oversized batch before logging", async () => {
		const { app, events } = create();
		expect((await request(app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`).send({ extra: "x".repeat(33 * 1_024) })).status).toBe(413);
		expect(events).toEqual([]);
	});

	it("rejects an empty authenticated request without recording a checkpoint", async () => {
		const { app, events } = create();
		expect((await request(app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`)).status).toBe(400);
		expect(events).toEqual([]);
	});

	it("does not acknowledge throttled or failed delivery", async () => {
		const throttled = create({ allowed: false });
		const response = await request(throttled.app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`).send({ schema_version: 1, events: [checkpoint] });
		expect(response.status).toBe(429);
		expect(response.headers["retry-after"]).toBe("12");
		expect(throttled.events).toEqual([]);
		const failed = create({ record: () => { throw new Error("delivery unavailable"); } });
		expect((await request(failed.app).post("/diagnostics/auth").set("Authorization", `Bearer ${permit}`).send({ schema_version: 1, events: [checkpoint] })).status).toBe(500);
	});
});

describe("upload-only permits", () => {
	it("expires independently from the login credentials after 210 days", () => {
		const claims = permits.verify(permit);
		expect(claims?.exp).toBe(at.getTime() / 1_000 + 210 * 86400);
		const later = initAuthDiagnosticPermits({ salt: "test-only-signing-secret", now: () => new Date(at.getTime() + 210 * 86400_000) });
		expect(later.verify(permit)).toBeUndefined();
		expect(initAuthDiagnosticPermits({ salt: "other-key", now: () => at }).verify(permit)).toBeUndefined();
	});

	it.each(["", "a", "a.b.c", "a.!", "a.a", "x".repeat(2_049)])("rejects malformed permits (%s)", value => {
		expect(permits.verify(value)).toBeUndefined();
	});

	it("rejects authenticated malformed payloads and wrong capabilities", () => {
		const key = createHmac("sha256", "test-only-signing-secret").update("readplace-auth-diagnostics-permit-v1").digest();
		for (const raw of ["not-json", JSON.stringify({ ...permits.verify(permit), scope: "read-account" })]) {
			const body = Buffer.from(raw).toString("base64url");
			const signature = createHmac("sha256", key).update(body).digest("base64url");
			expect(permits.verify(`${body}.${signature}`)).toBeUndefined();
		}
	});
});
