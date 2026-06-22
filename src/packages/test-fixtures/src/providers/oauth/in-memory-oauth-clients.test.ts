import assert from "node:assert/strict";
import { initInMemoryOAuthClients } from "./in-memory-oauth-clients";

const IDLE = 48 * 60 * 60;

const INPUT = {
	redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
	clientName: "Claude",
	grants: ["authorization_code", "refresh_token"],
	tokenEndpointAuthMethod: "none",
};

describe("initInMemoryOAuthClients", () => {
	it("registers a client with echoed metadata and a 48h idle TTL", async () => {
		const nowMs = 2_000_000_000_000;
		const store = initInMemoryOAuthClients({ now: () => new Date(nowMs) });
		const registered = await store.registerClient(INPUT);
		assert.ok(registered.id.length > 0);
		assert.equal(registered.name, "Claude");
		assert.equal(registered.clientIdIssuedAt, Math.floor(nowMs / 1000));
		assert.equal((await store.getClient(registered.id))?.id, registered.id);
	});

	it("defaults the name to the redirect host", async () => {
		const store = initInMemoryOAuthClients({ now: () => new Date(0) });
		const registered = await store.registerClient({
			redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
			grants: ["authorization_code"],
			tokenEndpointAuthMethod: "none",
		});
		assert.equal(registered.name, "claude.ai");
	});

	it("de-dupes identical registrations and re-mints once the row expires", async () => {
		let nowMs = 0;
		const store = initInMemoryOAuthClients({ now: () => new Date(nowMs) });
		const first = await store.registerClient(INPUT);
		assert.equal((await store.registerClient(INPUT)).id, first.id);
		nowMs = (IDLE + 1) * 1000;
		assert.notEqual((await store.registerClient(INPUT)).id, first.id);
	});

	it("hides an expired client and an unknown client", async () => {
		let nowMs = 0;
		const store = initInMemoryOAuthClients({ now: () => new Date(nowMs) });
		const registered = await store.registerClient(INPUT);
		nowMs = (IDLE + 1) * 1000;
		assert.equal(await store.getClient(registered.id), undefined);
		assert.equal(await store.getClient("nope"), undefined);
	});

	it("extends the TTL past the idle window on markClientActive and no-ops for unknown ids", async () => {
		let nowMs = 0;
		const store = initInMemoryOAuthClients({ now: () => new Date(nowMs) });
		const registered = await store.registerClient(INPUT);
		await store.markClientActive("nope");
		await store.markClientActive(registered.id);
		nowMs = (IDLE + 1) * 1000;
		assert.equal((await store.getClient(registered.id))?.id, registered.id);
	});

	it("defaults `now` to the wall clock when none is injected", async () => {
		const store = initInMemoryOAuthClients();
		const registered = await store.registerClient(INPUT);
		assert.ok(registered.clientIdIssuedAt > 0);
	});
});
