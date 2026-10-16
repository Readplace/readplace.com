import { AUTH_DIAGNOSTIC_LIMITS, AuthDiagnosticBatch } from "@packages/domain/auth-diagnostics";
import { initAuthJournal } from "./auth-journal";
import type { AuthState, AuthStateStore } from "./auth-state.types";
import { initRefreshProof } from "./refresh-proof";

async function fixture() {
	let now = Date.parse("2026-10-16T00:00:00Z");
	let state: AuthState = {
		version: 1, installationId: crypto.randomUUID(), epoch: crypto.randomUUID(),
		key: await initRefreshProof({ crypto, now: () => now, uuid: () => crypto.randomUUID() }).createKey(),
		credentials: null, pending: null, journal: [], permit: "permit-A", diagnosticsEndpoint: "https://readplace.test/diagnostics/auth",
	};
	const store: AuthStateStore = {
		async read() { return structuredClone(state); },
		async update(mutate) { const next = structuredClone(state); const result = mutate(next); state = next; return result; },
	};
	const batches: { permit: string | null; body: { schema_version: number; events: { event_id: string }[] } }[] = [];
	let reply = async (body: { events: { event_id: string }[] }) => new Response(JSON.stringify({ accepted_event_ids: body.events.map(event => event.event_id) }), { status: 200 });
	const journal = initAuthJournal({
		store, client: "chrome", version: "1.0.700", contextId: crypto.randomUUID(), now: () => now, uuid: () => crypto.randomUUID(),
		fetchFn: (async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			AuthDiagnosticBatch.parse(body);
			batches.push({ permit: new Headers(init?.headers).get("Authorization"), body });
			return reply(body);
		}) satisfies typeof fetch,
	});
	return { store, journal, batches, advance() { now += AUTH_DIAGNOSTIC_LIMITS.journalAgeMs + 1; }, reply(fn: typeof reply) { reply = fn; } };
}

describe("durable authentication diagnostics", () => {
	it("keeps each event's original permit through logout and a different login", async () => {
		const f = await fixture();
		await f.journal.write({ event: "credentials_cleared", reason: "user_requested" });
		await f.store.update(state => { state.permit = "permit-B"; });
		await f.journal.write({ event: "login_completed", outcome: "success" });
		await f.journal.flush(); await f.journal.flush();
		expect(f.batches.map(batch => batch.permit)).toEqual(["Bearer permit-A", "Bearer permit-B"]);
		expect((await f.store.read()).journal).toEqual([]);
	});

	it("does not erase unacknowledged events or trust acknowledgments for another batch", async () => {
		const f = await fixture(); await f.journal.write({ event: "refresh_prepared" });
		await f.store.update(state => { state.permit = "permit-B"; });
		await f.journal.write({ event: "login_completed" });
		const laterId = (await f.store.read()).journal[1].event.event_id;
		f.reply(async () => new Response(JSON.stringify({ accepted_event_ids: [laterId] }), { status: 200 }));
		await f.journal.flush();
		expect((await f.store.read()).journal).toHaveLength(2);
	});

	it.each(["network", "http", "malformed"])("retains the queue when upload fails: %s", async failure => {
		const f = await fixture(); await f.journal.write({ event: "refresh_failed" });
		f.reply(async () => {
			if (failure === "network") throw new Error("connection closed");
			return new Response(JSON.stringify({ wrong: true }), { status: failure === "http" ? 503 : 200 });
		});
		await Promise.all([f.journal.flush(), f.journal.flush()]);
		expect(f.batches).toHaveLength(1);
		expect((await f.store.read()).journal).toHaveLength(1);
	});

	it("keeps events local until discovery and an account permit are available", async () => {
		const f = await fixture(); await f.store.update(state => { delete state.diagnosticsEndpoint; });
		await f.journal.write({ event: "context_started" }); await f.journal.flush();
		await f.store.update(state => { state.diagnosticsEndpoint = "https://readplace.test/diagnostics/auth"; delete state.permit; state.journal = []; });
		await f.journal.write({ event: "login_started" }); await f.journal.flush();
		expect(f.batches).toEqual([]);
	});

	it("expires old diagnostics and bounds an offline journal and its upload batches", async () => {
		const f = await fixture(); await f.journal.write({ event: "context_started" }); f.advance();
		await f.journal.flush(); expect(f.batches).toEqual([]);
		await f.journal.write({ event: "login_started" });
		expect((await f.store.read()).journal.map(entry => entry.event.event)).toEqual(["login_started"]);
		for (let i = 0; i < 540; i++) await f.journal.write({
			event: "refresh_response_received", operation_id: crypto.randomUUID(), attempt_id: crypto.randomUUID(),
			generation: 1, http_status: 200, duration_ms: 300, storage_status: 0, outcome: "success", reason: "newer_generation",
		});
		const state = await f.store.read();
		expect(state.journal.length).toBeLessThanOrEqual(512);
		expect(new TextEncoder().encode(JSON.stringify(state.journal)).byteLength).toBeLessThanOrEqual(256 * 1024);
		expect(state.journal.at(-1)?.event.event).toBe("journal_health");
		await f.journal.flush();
		expect(f.batches[0].body.events.length).toBeLessThanOrEqual(64);
		expect(new TextEncoder().encode(JSON.stringify(f.batches[0].body)).byteLength).toBeLessThanOrEqual(32 * 1024);
	});

	it("caps ordinary small batches by event count", async () => {
		const f = await fixture();
		for (let i = 0; i < 70; i++) await f.journal.write({ event: "context_started" });
		await f.journal.flush();
		expect(f.batches[0].body.events).toHaveLength(64);
		expect((await f.store.read()).journal).toHaveLength(6);
	});

	it("excludes expired entries even when uploading without another journal write", async () => {
		const f = await fixture();
		await f.journal.write({ event: "context_started" }); await f.journal.write({ event: "login_completed" });
		await f.store.update(state => { state.journal[0].event.occurred_at = "2020-01-01T00:00:00Z"; });
		await f.journal.flush();
		expect(f.batches[0].body.events).toHaveLength(1);
	});
});
