import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import type { GmailHistoryImportJob, GmailHistoryImportStore } from "@packages/domain/gmail";
import { AliasNameSchema, GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import type { GmailMonitoringCheckpoint, GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";
import type { RevokeGmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { initInMemoryGmailFilters } from "@packages/test-fixtures/providers/gmail-filters";
import { initInMemoryGmailMonitoring } from "@packages/test-fixtures/providers/gmail-monitoring";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initCancelGmailHistoryImports } from "./cancel-gmail-history-imports";
import { initDisconnectGmail } from "./disconnect-gmail";
import { initRewriteGmailFilter } from "./rewrite-gmail-filter";
import type { RewriteGmailFilterOutcome } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const NOW = new Date("2026-08-27T00:00:00.000Z");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
const MAILBOX = "mailbox-1";
const NO_MONITOR_ROWS = {
	checkpoint: undefined,
	observations: { observations: [], nextPageToken: undefined },
	notices: { notices: [], nextPageToken: undefined },
	batch: undefined,
};

async function monitorRows(monitoring: GmailMonitoringStore) {
	return {
		checkpoint: await monitoring.findCheckpoint(USER),
		observations: await monitoring.listObservations({ userId: USER, mailboxId: MAILBOX }),
		notices: await monitoring.listNotices({ userId: USER }),
		batch: await monitoring.findNoticeBatch(USER),
	};
}

async function seedMonitor(monitoring: GmailMonitoringStore, gatewayAddress: GmailMonitoringCheckpoint["gatewayAddress"]) {
	const checkpoint: GmailMonitoringCheckpoint = { userId: USER, generation: "run", page: 0, mailboxId: MAILBOX, accountEmail: ACCOUNT, gatewayAddress, mode: "arrivals", initializing: false, historyId: "100", pageToken: undefined, scannedCount: 0, lastCheckedAt: NOW.getTime() };
	assert(await monitoring.startRun({ checkpoint, previous: undefined }));
	assert(await monitoring.observeSender({ checkpoint, observation: { email: TLDR, name: "TLDR", approved: true }, notify: true }));
	assert(await monitoring.claimNoticeBatch({ userId: USER, senders: [TLDR], message: { from: "hello@readplace.com", to: ACCOUNT, subject: "TLDR can reach Readplace", html: "<p>TLDR</p>" }, lastSentBefore: 0 }));
	const seeded = await monitorRows(monitoring);
	assert.deepEqual([seeded.checkpoint?.mailboxId, seeded.observations.observations.length, seeded.notices.notices.length, seeded.batch?.status], [MAILBOX, 1, 1, "sending"]);
}

async function makeHarness(options: {
	rewritten?: RewriteGmailFilterOutcome;
	revoked?: RevokeGmailGrantResult;
	connected?: boolean;
	credentialed?: boolean;
	gmail?: ReturnType<typeof initInMemoryGmailFilters>;
	eraseImports?: GmailHistoryImportStore["deleteAllByUserId"];
} = {}) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const credentials = initInMemoryGmailCredentials({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });
	const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
	const imports = initInMemoryGmailHistoryImport();
	const monitoring = initInMemoryGmailMonitoring({ now: () => NOW });
	const rewrites: string[] = [];
	const monitorRowsWhenGoogleAsked: Awaited<ReturnType<typeof monitorRows>>[] = [];
	const revokes: string[] = [];
	const gatewayEntry = await addresses.createAddress({
		userId: USER,
		domain: "read.place",
		name: GMAIL_FORWARDING_ALIAS,
		purpose: "gmail-forwarding",
	});
	const gateway = gatewayEntry.address;
	await discovery.startDiscovery({ checkedMessageCount: 0, userId: USER, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), gatewayAddress: gateway, generation: "initial", mode: "profile", historyId: undefined });

	if (options.connected !== false) {
		await connections.createConnection({
			userId: USER,
			gatewayAddress: gateway,
		});
		await connections.markForwardingConfirmed({ userId: USER });
		await connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		await senders.recordSenderSeen({ userId: USER, senderEmail: TLDR, subject: "TLDR 2026-08-27" });
	}
	if (options.credentialed !== false) {
		await credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});
	}

	const disconnect = initDisconnectGmail({
		connections,
		credentials,
		senders,
		discovery,
		monitoring,
		addresses,
		removeGmailFilter: options.gmail === undefined
			? async ({ userId }) => {
				rewrites.push(userId);
				monitorRowsWhenGoogleAsked.push(await monitorRows(monitoring));
				return options.rewritten ?? { ok: true, filterCount: 0, senderCount: 0 };
			}
			: initRewriteGmailFilter({
				filters: options.gmail.api,
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
		historyImports: { deleteAllByUserId: options.eraseImports ?? imports.deleteAllByUserId },
		logger: Logger.from(noopLogger),
	});

	return { disconnect, connections, credentials, senders, discovery, monitoring, addresses, gateway, rewrites, revokes, imports, monitorRowsWhenGoogleAsked };
}

describe("initDisconnectGmail", () => {
	it("cancels every unfinished import of the mailbox before the senders go", async () => {
		const harness = await makeHarness({ rewritten: { ok: false, reason: "unavailable", status: 503 } });
		const jobId = GmailHistoryImportJobIdSchema.parse("0".repeat(32));
		await harness.imports.createJob({
			userId: USER,
			jobId,
			senderEmail: TLDR,
			destinationAddresses: [harness.gateway],
			connection: { gatewayAddress: harness.gateway, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") },
			window: undefined,
			generation: "generation-1",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: "awaiting-permission",
			counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			completedAt: undefined,
		});

		await harness.disconnect({ userId: USER });

		const job = await harness.imports.findJob({ userId: USER, jobId });
		assert.deepEqual([job?.state, job?.cancelReason], ["cancelled", "disconnected"]);
	});

	it("erases the import records once Google has been reached", async () => {
		const harness = await makeHarness();
		const job: GmailHistoryImportJob = {
			userId: USER,
			jobId: GmailHistoryImportJobIdSchema.parse("1".repeat(32)),
			senderEmail: TLDR,
			destinationAddresses: [harness.gateway],
			connection: { gatewayAddress: harness.gateway, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") },
			window: undefined,
			generation: "generation-1",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: NOW.toISOString(),
			state: "complete",
			counts: { listed: 1, imported: 1, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			completedAt: NOW.toISOString(),
		};
		await harness.imports.createJob(job);

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual([result.ok, await harness.imports.listJobsByUserId(USER)], [true, []]);
	});

	it("keeps the connection when the import records cannot be erased, so the queue retries", async () => {
		const harness = await makeHarness({ eraseImports: async () => { throw new Error("DynamoDB throttled"); } });

		await assert.rejects(harness.disconnect({ userId: USER }), /DynamoDB throttled/);

		assert.equal((await harness.connections.findConnectionByUserId(USER))?.userId, USER);
	});

	it("clears what it saw of the senders, removes the filter, revokes at Google, then forgets the token", async () => {
		const harness = await makeHarness();

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: true, filterRemoved: true, grantRevoked: true });
		assert.deepEqual(await harness.senders.listSendersByUserId(USER), []);
		assert.deepEqual(harness.rewrites, [USER]);
		assert.deepEqual(harness.revokes, ["refresh-1"]);
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), undefined);
		assert.equal(await harness.discovery.findDiscoveryByUserId(USER), undefined);
	});

	it("removes the gateway filter and leaves the reader's own filters", async () => {
		const gmail = initInMemoryGmailFilters();
		const harness = await makeHarness({ gmail });
		const saveByEmail = await harness.addresses.createAddress({
			userId: USER,
			domain: "read.place",
			name: AliasNameSchema.parse("reading"),
			purpose: "user-alias",
		});
		const readersFilter = { id: "f-reader", query: "from:(boss@work.com)", forwardTo: saveByEmail.address };
		gmail.store.set("f-gateway", { id: "f-gateway", query: "from:(dan@tldr.tech)", forwardTo: harness.gateway });
		gmail.store.set(readersFilter.id, readersFilter);

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: true, filterRemoved: true, grantRevoked: true });
		assert.deepEqual(gmail.deleted, ["f-gateway"]);
		assert.deepEqual([...gmail.store.values()], [readersFilter]);
	});

	it("leaves no observation, notice or checkpoint row of the mailbox", async () => {
		const harness = await makeHarness();
		await seedMonitor(harness.monitoring, harness.gateway);

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: true, filterRemoved: true, grantRevoked: true });
		assert.deepEqual(await monitorRows(harness.monitoring), NO_MONITOR_ROWS);
	});

	it("clears the monitor's rows even when the connection is already gone", async () => {
		const harness = await makeHarness({ connected: false });
		await seedMonitor(harness.monitoring, harness.gateway);

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: false, reason: "not-connected" });
		assert.deepEqual(await monitorRows(harness.monitoring), NO_MONITOR_ROWS);
	});

	it("clears the rows before Google is asked, so an outage retry finds nothing to redo", async () => {
		const harness = await makeHarness({ rewritten: { ok: false, reason: "unavailable", status: 503 } });
		await seedMonitor(harness.monitoring, harness.gateway);

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: false, reason: "unavailable" });
		assert.deepEqual(harness.monitorRowsWhenGoogleAsked, [NO_MONITOR_ROWS]);

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: false, reason: "unavailable" });
		assert.deepEqual(harness.monitorRowsWhenGoogleAsked, [NO_MONITOR_ROWS, NO_MONITOR_ROWS]);
		assert.deepEqual(await monitorRows(harness.monitoring), NO_MONITOR_ROWS);
	});

	it("deletes the connection and retires the gateway so a leftover rule no longer routes", async () => {
		const harness = await makeHarness();

		await harness.disconnect({ userId: USER });

		assert.equal(await harness.connections.findConnectionByUserId(USER), undefined);
		const gateway = await harness.addresses.findByAddress(harness.gateway);
		assert(gateway, "the gateway row survives disconnect, disabled rather than deleted");
		assert.equal(gateway.disabledAt, NOW.toISOString());
	});

	it("still disconnects when the Gmail filter could not be removed", async () => {
		const harness = await makeHarness({
			rewritten: { ok: false, reason: "rejected", message: "no such filter" },
		});

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: true, filterRemoved: false, grantRevoked: true });
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), undefined);
	});

	it("retries rather than half-disconnecting when Gmail is unavailable", async () => {
		const harness = await makeHarness({
			rewritten: { ok: false, reason: "unavailable", status: 503 },
		});

		assert.deepEqual(await harness.disconnect({ userId: USER }), {
			ok: false,
			reason: "unavailable",
		});
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), "refresh-1");
		assert.deepEqual(harness.revokes, []);
		assert.equal((await harness.addresses.findByAddress(harness.gateway))?.disabledAt, undefined);
	});

	it("keeps the token when Google cannot be reached to revoke it", async () => {
		const harness = await makeHarness({
			revoked: { ok: false, reason: "unavailable", status: 500 },
		});

		assert.deepEqual(await harness.disconnect({ userId: USER }), {
			ok: false,
			reason: "unavailable",
		});
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), "refresh-1");
		assert.equal((await harness.addresses.findByAddress(harness.gateway))?.disabledAt, undefined);
	});

	it("finishes without calling Google when there is no token left to revoke", async () => {
		const harness = await makeHarness({ credentialed: false });

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: true, filterRemoved: true, grantRevoked: false });
		assert.deepEqual(harness.revokes, []);
	});

	it("reports a user who has no Gmail connection at all", async () => {
		const harness = await makeHarness({ connected: false });

		assert.deepEqual(await harness.disconnect({ userId: USER }), {
			ok: false,
			reason: "not-connected",
		});
		assert.deepEqual(harness.rewrites, []);
		assert.equal(await harness.discovery.findDiscoveryByUserId(USER), undefined);
	});

	it("retries discovered-sender deletion after the connection was already removed", async () => {
		const harness = await makeHarness();
		const previous = await harness.discovery.findDiscoveryByUserId(USER);
		assert(previous, "the discovery state must exist before disconnect");
		await harness.discovery.savePage({
			previous,
			senders: [{ email: TLDR, name: "TLDR" }],
			mode: "history",
			pageToken: undefined,
			historyId: "100",
			state: "complete",
			scannedMessages: 1,
			estimatedTotalMessages: undefined,
			oldestScannedAt: undefined,
		});
		const deleteDiscovery = harness.discovery.deleteDiscoveryByUserId;
		let attempts = 0;
		harness.discovery.deleteDiscoveryByUserId = async (userId) => {
			if (++attempts === 1) throw new Error("DynamoDB unavailable");
			await deleteDiscovery(userId);
		};

		await assert.rejects(harness.disconnect({ userId: USER }), /DynamoDB unavailable/);
		assert.equal(await harness.connections.findConnectionByUserId(USER), undefined);
		assert.equal((await harness.discovery.listSendersByUserId(USER)).length, 1);

		assert.deepEqual(await harness.disconnect({ userId: USER }), { ok: false, reason: "not-connected" });
		assert.equal(await harness.discovery.findDiscoveryByUserId(USER), undefined);
		assert.deepEqual(await harness.discovery.listSendersByUserId(USER), []);
		assert.deepEqual(harness.revokes, ["refresh-1"]);
	});
});
