import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import { GMAIL_FORWARDING_ALIAS, InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import type { GmailMonitoringCheckpoint } from "@packages/provider-contracts/gmail-monitoring";
import type { RevokeGmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { initInMemoryGmailFilters } from "@packages/test-fixtures/providers/gmail-filters";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailMonitoring } from "@packages/test-fixtures/providers/gmail-monitoring";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initCancelGmailHistoryImports } from "./cancel-gmail-history-imports";
import { initDisconnectGmail } from "./disconnect-gmail";
import { initDisconnectGmailWhenRequested } from "./disconnect-gmail-when-requested";
import { initRewriteGmailFilter } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const NOW = new Date("2026-11-08T00:00:00.000Z");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

async function makeHarness(options: {
	revoked?: RevokeGmailGrantResult;
	connectionsFor?: (store: GmailConnectionStore) => GmailConnectionStore;
} = {}) {
	const store = initInMemoryGmailConnection({ now: () => NOW });
	const connections = options.connectionsFor === undefined ? store : options.connectionsFor(store);
	const credentials = initInMemoryGmailCredentials({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });
	const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
	const monitoring = initInMemoryGmailMonitoring({ now: () => NOW });
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
	const gmail = initInMemoryGmailFilters();
	const imports = initInMemoryGmailHistoryImport();
	const revokes: string[] = [];
	const gatewayEntry = await addresses.createAddress({
		userId: USER,
		domain: "read.place",
		name: GMAIL_FORWARDING_ALIAS,
		purpose: "gmail-forwarding",
	});
	const gateway = gatewayEntry.address;

	const disconnect = initDisconnectGmailWhenRequested({
		connections,
		discovery,
		monitoring,
		disconnectGmail: initDisconnectGmail({
			connections,
			credentials,
			senders,
			discovery,
			monitoring,
			addresses,
			removeGmailFilter: initRewriteGmailFilter({
				filters: gmail.api,
				connections,
				mappings: { listMappings: async () => [] },
				addresses,
				now: () => NOW,
				logger: Logger.from(noopLogger),
			}),
			revokeGmailGrant: async ({ refreshToken }) => {
				revokes.push(refreshToken);
				return options.revoked ?? { ok: true };
			},
			cancelGmailHistoryImports: initCancelGmailHistoryImports({ imports, now: () => NOW }),
			historyImports: imports,
			logger: Logger.from(noopLogger),
		}),
	});

	const connect = async () => {
		await store.createConnection({ userId: USER, gatewayAddress: gateway });
		await store.markForwardingConfirmed({ userId: USER });
		await store.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		await senders.recordSenderSeen({ userId: USER, senderEmail: TLDR, subject: "TLDR 2026-11-08" });
		await credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		gmail.store.set("f-gateway", { id: "f-gateway", query: "from:(dan@tldr.tech)", forwardTo: gateway });
	};

	const snapshot = async () => ({
		connection: await store.findConnectionByUserId(USER),
		refreshToken: await credentials.findRefreshTokenByUserId(USER),
		gateway: await addresses.findByAddress(gateway),
		senders: await senders.listSendersByUserId(USER),
		filters: [...gmail.store.values()],
	});

	return { disconnect, store, credentials, discovery, monitoring, addresses, gmail, revokes, gateway, connect, snapshot };
}

describe("initDisconnectGmailWhenRequested", () => {
	it("leaves a reader who reconnected connected when an old disconnect is redriven", async () => {
		const harness = await makeHarness();
		await harness.connect();
		const before = await harness.snapshot();

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-requested" });
		assert.deepEqual(await harness.snapshot(), before);
		assert.deepEqual(harness.revokes, []);
		assert.deepEqual([harness.gmail.created, harness.gmail.deleted], [[], []]);
	});

	it("tears down a disconnecting row, and a second run finds nothing", async () => {
		const harness = await makeHarness();
		await harness.connect();
		await harness.store.markDisconnectRequested({ userId: USER });

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: true, filterRemoved: true, grantRevoked: true });
		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: false, reason: "not-connected" });
		assert.equal(await harness.store.findConnectionByUserId(USER), undefined);
		assert.deepEqual(harness.revokes, ["refresh-1"]);
	});

	it("clears discovery and monitoring left by a teardown that died after deleting the row", async () => {
		const harness = await makeHarness();
		await harness.discovery.startDiscovery({ checkedMessageCount: 0, userId: USER, accountEmail: ACCOUNT, gatewayAddress: harness.gateway, generation: "initial", mode: "profile", historyId: undefined });
		const checkpoint: GmailMonitoringCheckpoint = { userId: USER, generation: "run", page: 0, mailboxId: "mailbox-1", accountEmail: ACCOUNT, gatewayAddress: harness.gateway, mode: "arrivals", initializing: false, historyId: "100", pageToken: undefined, scannedCount: 0, lastCheckedAt: NOW.getTime() };
		assert(await harness.monitoring.startRun({ checkpoint, previous: undefined }));

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-connected" });
		assert.equal(await harness.discovery.findDiscoveryByUserId(USER), undefined);
		assert.equal(await harness.monitoring.findCheckpoint(USER), undefined);
	});

	it("leaves a connection created just after the fence read alone", async () => {
		let reads = 0;
		const harness = await makeHarness({
			connectionsFor: (store) => ({
				...store,
				findConnectionByUserId: async (userId) => {
					reads += 1;
					if (reads > 1) return store.findConnectionByUserId(userId);
					await harness.connect();
					return undefined;
				},
			}),
		});

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-connected" });
		const created = await harness.store.findConnectionByUserId(USER);
		assert.deepEqual(created, {
			userId: USER,
			gatewayAddress: harness.gateway,
			accountEmail: ACCOUNT,
			connectedAt: NOW.toISOString(),
			forwardingConfirmedAt: NOW.toISOString(),
			lastConfirmError: undefined,
			filterCount: undefined,
			filterSenderCount: undefined,
			filterUpdatedAt: undefined,
			lastFilterError: undefined,
			revokedAt: undefined,
			revokedReason: undefined,
			disconnectRequestedAt: undefined,
		});
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), "refresh-1");
		assert.deepEqual(harness.revokes, []);
		assert.deepEqual([harness.gmail.created, harness.gmail.deleted], [[], []]);
	});

	it("leaves the new connection alone when a partly failed teardown is redriven after a reconnect", async () => {
		const harness = await makeHarness();
		await harness.discovery.startDiscovery({ checkedMessageCount: 0, userId: USER, accountEmail: ACCOUNT, gatewayAddress: InboxAddressSchema.parse("gmail-0ld0ld@read.place"), generation: "stale", mode: "profile", historyId: undefined });
		await harness.connect();
		const before = await harness.snapshot();

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-requested" });
		assert.deepEqual(await harness.snapshot(), before);
	});

	it("does not treat a revoked connection as a disconnect request", async () => {
		const harness = await makeHarness();
		await harness.connect();
		await harness.store.markRevoked({ userId: USER, reason: "invalid-grant" });
		const before = await harness.snapshot();

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-requested" });
		assert.deepEqual(await harness.snapshot(), before);
	});

	it("tears down a row marked by a later request, then converges", async () => {
		const harness = await makeHarness();
		await harness.connect();
		await harness.store.markDisconnectRequested({ userId: USER });
		await harness.store.markDisconnectRequested({ userId: USER });

		const results = [await harness.disconnect({ userId: USER }), await harness.disconnect({ userId: USER })];

		assert.deepEqual(results, [
			{ ok: true, filterRemoved: true, grantRevoked: true },
			{ ok: false, reason: "not-connected" },
		]);
		assert.equal(await harness.store.findConnectionByUserId(USER), undefined);
	});

	it("removes the Gmail filter from a disconnecting row", async () => {
		const harness = await makeHarness();
		await harness.connect();
		await harness.store.markDisconnectRequested({ userId: USER });

		await harness.disconnect({ userId: USER });

		assert.deepEqual([...harness.gmail.store.values()], []);
		assert.deepEqual(harness.gmail.deleted, ["f-gateway"]);
	});

	it("reports Google being unavailable so the command can be retried", async () => {
		const harness = await makeHarness({ revoked: { ok: false, reason: "unavailable", status: 503 } });
		await harness.connect();
		await harness.store.markDisconnectRequested({ userId: USER });

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "unavailable" });
		const connection = await harness.store.findConnectionByUserId(USER);
		assert.equal(connection?.disconnectRequestedAt, NOW.toISOString());
	});
});
