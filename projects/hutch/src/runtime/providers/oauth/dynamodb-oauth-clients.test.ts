import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbOAuthClients } from "./dynamodb-oauth-clients";

type Command = { input: { Item?: Record<string, unknown>; Key?: { pk?: unknown } } };

const TABLE = "test-oauth";
const IDLE = 48 * 60 * 60;
const ACTIVE = 365 * 24 * 60 * 60;

// A stateful in-memory stand-in for the document client: PutCommand carries an
// `Item`, GetCommand carries a `Key`, so the input shape distinguishes them
// without importing the SDK command classes (not a direct dependency here).
function createFakeClient(): {
	client: DynamoDBDocumentClient;
	rows: Map<string, Record<string, unknown>>;
} {
	const rows = new Map<string, Record<string, unknown>>();
	const send = async (command: Command) => {
		const { Item, Key } = command.input;
		if (Item) {
			rows.set(String(Item.pk), Item);
			return {};
		}
		assert(Key, "command must carry an Item or a Key");
		return { Item: rows.get(String(Key.pk)) };
	};
	// One contained cast: the fake only implements `.send`, which is all
	// defineDynamoTable calls; the structural shape can't satisfy the SDK's
	// overloaded client type without it.
	return { client: { send } as unknown as DynamoDBDocumentClient, rows };
}

const REGISTER_INPUT = {
	redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
	clientName: "Claude",
	grants: ["authorization_code", "refresh_token"],
	tokenEndpointAuthMethod: "none",
};

describe("initDynamoDbOAuthClients", () => {
	it("registers a client with a generated id, echoed metadata and a 48h idle TTL", async () => {
		const { client, rows } = createFakeClient();
		const nowMs = 1_000_000_000_000;
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(nowMs) });

		const registered = await store.registerClient(REGISTER_INPUT);

		assert.ok(registered.id.length > 0);
		assert.equal(registered.name, "Claude");
		assert.deepEqual(registered.redirectUris, REGISTER_INPUT.redirectUris);
		assert.deepEqual(registered.grants, REGISTER_INPUT.grants);
		assert.equal(registered.tokenEndpointAuthMethod, "none");
		assert.equal(registered.clientIdIssuedAt, Math.floor(nowMs / 1000));

		const stored = rows.get(`client#${registered.id}`);
		assert.equal(stored?.expiresAt, Math.floor(nowMs / 1000) + IDLE);
	});

	it("defaults client_name to the redirect host when none is supplied", async () => {
		const { client } = createFakeClient();
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(0) });
		const registered = await store.registerClient({
			redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
			grants: ["authorization_code"],
			tokenEndpointAuthMethod: "none",
		});
		assert.equal(registered.name, "claude.ai");
	});

	it("returns the existing client_id for an identical re-registration (de-dup)", async () => {
		const { client } = createFakeClient();
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(0) });
		const first = await store.registerClient(REGISTER_INPUT);
		const second = await store.registerClient({ ...REGISTER_INPUT });
		assert.equal(second.id, first.id);
	});

	it("mints a new client when an identical registration's row has expired", async () => {
		const { client } = createFakeClient();
		let nowMs = 0;
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(nowMs) });
		const first = await store.registerClient(REGISTER_INPUT);
		nowMs = (IDLE + 1) * 1000;
		const second = await store.registerClient(REGISTER_INPUT);
		assert.notEqual(second.id, first.id);
	});

	it("resolves a live client and not an expired one", async () => {
		const { client } = createFakeClient();
		let nowMs = 0;
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(nowMs) });
		const registered = await store.registerClient(REGISTER_INPUT);

		assert.equal((await store.getClient(registered.id))?.id, registered.id);
		nowMs = (IDLE + 1) * 1000;
		assert.equal(await store.getClient(registered.id), undefined);
	});

	it("returns undefined for an unknown client", async () => {
		const { client } = createFakeClient();
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(0) });
		assert.equal(await store.getClient("nope"), undefined);
	});

	it("extends the TTL to a year when a client is marked active", async () => {
		const { client, rows } = createFakeClient();
		const nowMs = 5_000_000;
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(nowMs) });
		const registered = await store.registerClient(REGISTER_INPUT);

		await store.markClientActive(registered.id);

		assert.equal(
			rows.get(`client#${registered.id}`)?.expiresAt,
			Math.floor(nowMs / 1000) + ACTIVE,
		);
	});

	it("is a no-op when marking an unknown or expired client active", async () => {
		const { client } = createFakeClient();
		const store = initDynamoDbOAuthClients({ client, tableName: TABLE, now: () => new Date(0) });
		await store.markClientActive("nope");
	});
});
