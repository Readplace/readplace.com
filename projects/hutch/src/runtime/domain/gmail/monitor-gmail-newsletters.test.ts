import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initCatalogNewsletterDetector, NewsletterFromSchema, NewsletterNameSchema, type NewsletterCatalogRecord } from "@packages/domain/newsletter-catalog";
import type { GmailIncomingMailbox, GmailIncomingSenderPage } from "@packages/provider-contracts/gmail-mailbox";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { initInMemoryGmailMonitoring } from "@packages/test-fixtures/providers/gmail-monitoring";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initMonitorGmailNewsletters } from "./monitor-gmail-newsletters";

const USER = UserIdSchema.parse("reader");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-reader@read.place");
const SENDER = ForwardableSenderSchema.parse("letter@example.com");
const NOW = Date.parse("2026-10-04T00:00:00Z");
const EMPTY: GmailIncomingSenderPage = { senders: [], nextPageToken: undefined, scannedMessages: 0, estimatedTotalMessages: undefined, newestMessageAt: undefined, oldestMessageAt: undefined };

function record(input: { from?: string; status?: "approved" | "pending" | "rejected"; name?: string }): NewsletterCatalogRecord {
	return { from: NewsletterFromSchema.parse(input.from ?? SENDER), status: input.status ?? "approved", name: input.name === undefined ? undefined : NewsletterNameSchema.parse(input.name), evidence: [], createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
}
async function harness() {
	let instant = NOW;
	let generation = 0;
	const now = () => new Date(instant);
	const connections = initInMemoryGmailConnection({ now });
	const discovery = initInMemoryGmailDiscovery({ now });
	const monitoring = initInMemoryGmailMonitoring({ now });
	const senders = initInMemoryGmailSender({ now });
	await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
	await connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
	const catalog = { available: true, records: [record({})] };
	const calls: unknown[] = [];
	const mailbox: GmailIncomingMailbox = {
		findProfile: async () => { calls.push("profile"); return { ok: true, value: { accountEmail: ACCOUNT, historyId: "100" } }; },
		listMessageSenders: async () => ({ ok: true, value: EMPTY }),
		listChangedMessageSenders: async () => ({ ok: true, value: { ...EMPTY, historyId: "200" } }),
		listCurrentIncomingMessageSenders: async (input) => { calls.push({ baseline: input }); return { ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: "Letter", lastMessageAt: NOW - 10_000 }], scannedMessages: 1 } }; },
		listIncomingMessageSenders: async (input) => { calls.push({ history: input }); return { ok: true, value: { ...EMPTY, historyId: "200" } }; },
	};
	const deps = { mailbox, connections, discovery, monitoring, senders, detectNewsletters: initCatalogNewsletterDetector({ readCatalog: async () => catalog.available ? { ok: true, document: { version: 1, records: catalog.records } } : { ok: false, reason: "unavailable" } }), newGeneration: () => `run-${++generation}`, now };
	const monitor = initMonitorGmailNewsletters(deps);
	async function run() {
		let result = await monitor.start(USER);
		const notices = [...result.notices];
		let iterations = 0;
		while (result.nextPage !== undefined) {
			assert(++iterations < 1_000);
			result = await monitor.page(result.nextPage);
			notices.push(...result.notices);
		}
		return notices;
	}
	async function state() { const checkpoint = await monitoring.findCheckpoint(USER); assert(checkpoint); return checkpoint; }
	return { ...deps, catalog, calls, monitor, run, state, advance: (ms = 120_001) => { instant += ms; } };
}

describe("Gmail newsletter monitoring", () => {
	it("silently baselines current mail, then produces a pending notice for a new approved arrival", async () => {
		const h = await harness();
		assert.deepEqual(await h.run(), []);
		assert.equal((await h.state()).historyId, "200");
		assert.equal(await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }), undefined);
		h.mailbox.listIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined }], historyId: "300" } });
		assert.deepEqual(await h.run(), [SENDER]);
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "pending");
		assert.deepEqual(await h.monitoring.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), [{ email: SENDER, name: "Letter" }]);
	});
	it("catches arrivals during initialization from a profile cursor captured before scanning", async () => {
		const h = await harness();
		h.mailbox.listIncomingMessageSenders = async (input) => {
			assert.equal(input.startHistoryId, "100");
			return { ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: "New arrival" }], historyId: "200" } };
		};
		assert.deepEqual(await h.run(), [SENDER]);
		assert.equal(h.calls[0], "profile");
	});
	it.each(["pending", "rejected", "unknown"])("retains %s senders and notices subsequent admin approval", async (status) => {
		const h = await harness();
		h.catalog.records = status === "unknown" ? [] : [record({ status: status === "pending" ? "pending" : "rejected" })];
		assert.deepEqual(await h.run(), []);
		assert.equal((await h.monitoring.findObservation({ userId: USER, mailboxId: (await h.state()).mailboxId, senderEmail: SENDER }))?.approved, false);
		h.catalog.records = [record({ name: "Approved name" })];
		assert.deepEqual(await h.run(), [SENDER]);
	});
	it("uses exact pending/rejected overrides and effective approval rather than wildcard/exact identity or renames", async () => {
		const h = await harness();
		h.catalog.records = [record({ from: "*@example.com" }), record({ status: "pending" })];
		await h.run();
		h.catalog.records = [record({ from: "*@example.com" }), record({ status: "rejected" })];
		assert.deepEqual(await h.run(), []);
		h.catalog.records = [record({ from: "*@example.com" })];
		assert.deepEqual(await h.run(), [SENDER]);
		const notice = await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }); assert(notice);
		await h.monitoring.claimNotice({ notice, message: { from: "Readplace", to: "reader@readplace.test", subject: "Notice", html: "Notice" } });
		await h.monitoring.markNoticeSent({ userId: USER, senderEmail: SENDER });
		h.catalog.records = [record({ from: "*@example.com", name: "Renamed" }), record({ name: "Automatic exact" })];
		assert.deepEqual(await h.run(), []);
	});
	it("does not notify for a renamed catalog or an automatic exact approval below an already-approved wildcard", async () => {
		const h = await harness();
		h.catalog.records = [record({ from: "*@example.com" })];
		await h.run();
		h.catalog.records = [record({ from: "*@example.com", name: "Renamed" }), record({ name: "Auto" })];
		assert.deepEqual(await h.run(), []);
	});
	it("consumes approvals while mapped so removing the mapping alone produces no email", async () => {
		const h = await harness();
		h.catalog.records = [];
		await h.run();
		await h.senders.addSenderToFilter({ userId: USER, senderEmail: SENDER });
		h.catalog.records = [record({})];
		assert.deepEqual(await h.run(), []);
		await h.senders.removeSender({ userId: USER, senderEmail: SENDER });
		assert.deepEqual(await h.run(), []);
		h.mailbox.listIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined }], historyId: "300" } });
		assert.deepEqual(await h.run(), [SENDER]);
	});
	it("preserves sent receipts across mapping removal and same-mailbox reconnection", async () => {
		const h = await harness();
		await h.run();
		h.mailbox.listIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined }], historyId: "300" } });
		await h.run();
		const notice = await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }); assert(notice);
		await h.monitoring.claimNotice({ notice, message: { from: "Readplace", to: "reader@readplace.test", subject: "Notice", html: "Notice" } });
		await h.monitoring.markNoticeSent({ userId: USER, senderEmail: SENDER });
		await h.connections.deleteConnection(USER);
		assert.deepEqual(await h.run(), []);
		await h.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		assert.deepEqual(await h.run(), []);
	});
	it("separates interactive discovery history and silently includes senders beyond the recent mailbox window", async () => {
		const h = await harness();
		const oldSender = ForwardableSenderSchema.parse("old@example.com");
		await h.discovery.startDiscovery({ userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "interactive", mode: "full", historyId: "interactive-100", checkedMessageCount: 0 });
		const previous = await h.discovery.findDiscoveryByUserId(USER); assert(previous);
		await h.discovery.savePage({ previous, senders: [{ email: oldSender, name: "Old" }], mode: "history", pageToken: undefined, historyId: "interactive-200", state: "complete", scannedMessages: 1, estimatedTotalMessages: undefined, oldestScannedAt: undefined });
		await h.run();
		assert.equal((await h.discovery.findDiscoveryByUserId(USER))?.historyId, "interactive-200");
		h.catalog.records.push(record({ from: oldSender }));
		assert.deepEqual(await h.run(), [oldSender]);
	});
	it("paginates mailbox history and recent baseline and retains its starting history cursor until the last page", async () => {
		const h = await harness();
		const historyInputs: unknown[] = [];
		h.mailbox.listCurrentIncomingMessageSenders = async ({ pageToken }) => ({ ok: true, value: { ...EMPTY, nextPageToken: pageToken === undefined ? "last" : "older", scannedMessages: 2_500 } });
		h.mailbox.listIncomingMessageSenders = async (input) => {
			historyInputs.push(input);
			return { ok: true, value: { ...EMPTY, nextPageToken: input.pageToken === undefined ? "last" : undefined, historyId: input.pageToken === undefined ? "200" : "300" } };
		};
		assert.deepEqual(await h.run(), []);
		assert.deepEqual(historyInputs, [{ userId: USER, startHistoryId: "100", pageToken: undefined }, { userId: USER, startHistoryId: "100", pageToken: "last" }]);
		assert.equal((await h.state()).historyId, "300");
	});
	it("resumes stale/duplicate deliveries, serializes overlapping pages and recovers the claimed page after failure", async () => {
		const h = await harness();
		const start = await h.monitor.start(USER); assert(start.nextPage);
		assert.deepEqual(await h.monitor.start(USER), start);
		assert.deepEqual(await h.monitor.page({ ...start.nextPage, generation: "stale" }), { nextPage: undefined, notices: [] });
		const after = await h.monitor.page(start.nextPage); assert(after.nextPage);
		assert.deepEqual(await h.monitor.page(start.nextPage), after);
		await h.monitoring.claimPage(after.nextPage);
		await assert.rejects(h.monitor.page(after.nextPage), /already being processed/);
		h.advance();
		assert((await h.monitor.page(after.nextPage)).nextPage);
	});
	it("recovers expired history with full metadata pagination, preserves observations and notifies approval transitions", async () => {
		const h = await harness(); h.catalog.records = [];
		await h.run(); h.advance(10_000);
		h.catalog.records = [record({})];
		let expired = true;
		h.mailbox.listIncomingMessageSenders = async () => {
			if (expired) { expired = false; return { ok: false, reason: "history-expired" }; }
			return { ok: true, value: { ...EMPTY, historyId: "400" } };
		};
		let pages = 0;
		h.mailbox.listCurrentIncomingMessageSenders = async ({ pageToken }) => {
			pages++;
			return { ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined, lastMessageAt: NOW - 10_000 }], scannedMessages: 5_000, nextPageToken: pageToken === undefined ? "more" : undefined } };
		};
		assert.deepEqual(await h.run(), [SENDER]);
		assert.equal(pages, 2);
		assert.equal((await h.state()).historyId, "400");
	});
	it("resync finds missed new mail without notifying old baseline mail", async () => {
		const h = await harness(); await h.run(); h.advance(10_000);
		let expired = true;
		h.mailbox.listIncomingMessageSenders = async () => {
			if (expired) { expired = false; return { ok: false, reason: "history-expired" }; }
			return { ok: true, value: { ...EMPTY, historyId: "400" } };
		};
		h.mailbox.listCurrentIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined, lastMessageAt: NOW + 5_000 }] } });
		assert.deepEqual(await h.run(), [SENDER]);
	});
	it("resetting a changed connected mailbox silently reinitializes observations", async () => {
		const h = await harness(); await h.run();
		const previous = await h.state();
		const other = GmailAccountEmailSchema.parse("other@gmail.com");
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: other });
		h.mailbox.findProfile = async () => ({ ok: true, value: { accountEmail: other, historyId: "500" } });
		h.mailbox.listCurrentIncomingMessageSenders = async () => ({ ok: true, value: EMPTY });
		assert.deepEqual(await h.run(), []);
		assert.equal((await h.state()).mailboxId === previous.mailboxId, false);
		assert.deepEqual(await h.monitoring.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), []);
		assert.deepEqual(await h.monitoring.listObservedSenders({ userId: USER, accountEmail: other }), []);
	});
	it.each(["revoked", "disconnecting", "absent", "account-missing"])("does not monitor %s connections", async (state) => {
		const h = await harness();
		if (state === "revoked") await h.connections.markRevoked({ userId: USER, reason: "invalid-grant" });
		if (state === "disconnecting") await h.connections.markDisconnectRequested({ userId: USER });
		if (state === "absent") await h.connections.deleteConnection(USER);
		if (state === "account-missing") await h.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		assert.deepEqual(await h.run(), []);
		assert.deepEqual(h.calls, []);
	});
	it("stops an in-flight page if its mailbox or gateway no longer matches", async () => {
		const h = await harness(); const result = await h.monitor.start(USER); assert(result.nextPage);
		await h.connections.createConnection({ userId: USER, gatewayAddress: InboxAddressSchema.parse("gmail-others@read.place") });
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		assert.deepEqual(await h.monitor.page(result.nextPage), { nextPage: undefined, notices: [] });
		const restarted = await h.monitor.start(USER); assert(restarted.nextPage);
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") });
		assert.deepEqual(await h.monitor.page(restarted.nextPage), { nextPage: undefined, notices: [] });
	});
	it("catalog outages preserve observations and the checkpoint for a retry", async () => {
		const h = await harness(); h.catalog.available = false;
		const result = await h.monitor.start(USER); assert(result.nextPage);
		const seed = await h.monitor.page(result.nextPage); assert(seed.nextPage);
		await assert.rejects(h.monitor.page(seed.nextPage), /catalog unavailable/);
		assert.equal((await h.state()).mode, "discovered");
		h.advance(); h.catalog.available = true;
		assert.deepEqual(await h.run(), []);
	});
	it.each(["metadata-permission-required", "reauth-required", "rejected", "unavailable"])("handles Gmail %s without advancing the cursor", async (reason) => {
		const h = await harness();
		h.mailbox.findProfile = async () => reason === "unavailable" ? { ok: false, reason: "unavailable", status: 503 } : reason === "rejected" ? { ok: false, reason: "rejected", status: 403, message: "Denied" } : { ok: false, reason: reason === "reauth-required" ? "reauth-required" : "metadata-permission-required" };
		const start = await h.monitor.start(USER); assert(start.nextPage);
		if (reason === "unavailable") await assert.rejects(h.monitor.page(start.nextPage), /unavailable/);
		else assert.deepEqual(await h.monitor.page(start.nextPage), { nextPage: undefined, notices: [] });
		assert.equal((await h.state()).mode, "profile");
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedAt !== undefined, reason === "reauth-required");
	});
	it("does not accept metadata from a different OAuth mailbox", async () => {
		const h = await harness(); h.mailbox.findProfile = async () => ({ ok: true, value: { accountEmail: GmailAccountEmailSchema.parse("other@gmail.com"), historyId: "100" } });
		assert.deepEqual(await h.run(), []);
		assert.equal((await h.state()).mode, "profile");
	});
});

describe("monitoring discovery and durable notices", () => {
	it("retains later interactive discovery outside the recent scan and notices the next effective approval", async () => {
		const h = await harness(); await h.run();
		const oldSender = ForwardableSenderSchema.parse("historic@example.com");
		await h.discovery.startDiscovery({ userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "interactive-later", mode: "full", historyId: "interactive-100", checkedMessageCount: 0 });
		const previous = await h.discovery.findDiscoveryByUserId(USER); assert(previous);
		await h.discovery.savePage({ previous, senders: [{ email: oldSender, name: "Historic" }], mode: "history", pageToken: undefined, historyId: "interactive-200", state: "complete", scannedMessages: 1, estimatedTotalMessages: undefined, oldestScannedAt: undefined });
		assert.deepEqual(await h.run(), []);
		h.catalog.records.push(record({ from: oldSender }));
		assert.deepEqual(await h.run(), [oldSender]);
	});
	it("replays durable final notices when event publication is interrupted after the checkpoint is saved", async () => {
		const h = await harness(); await h.run();
		h.mailbox.listIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined }], historyId: "300" } });
		let next = (await h.monitor.start(USER)).nextPage; assert(next);
		while ((await h.state()).mode !== "notices") {
			next = (await h.monitor.page(next)).nextPage; assert(next);
		}
		const result = await h.monitor.page(next);
		assert.deepEqual(result, { nextPage: undefined, notices: [SENDER] });
		assert.deepEqual(await h.monitor.page(next), result);
	});
	it("paginates discovered observations and pending notices without skipping senders", async () => {
		const h = await harness();
		const many = Array.from({ length: 30 }, (_, index) => ({ email: ForwardableSenderSchema.parse(`sender${index}@example.com`), name: undefined }));
		await h.discovery.startDiscovery({ userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "interactive", mode: "full", historyId: "interactive-100", checkedMessageCount: 0 });
		const previous = await h.discovery.findDiscoveryByUserId(USER); assert(previous);
		await h.discovery.savePage({ previous, senders: many, mode: "history", pageToken: undefined, historyId: "interactive-200", state: "complete", scannedMessages: 30, estimatedTotalMessages: undefined, oldestScannedAt: undefined });
		await h.run();
		h.catalog.records.push(...many.map((sender) => record({ from: sender.email })));
		const noticed = await h.run();
		assert.deepEqual([...noticed].sort(), many.map((sender) => sender.email).sort());
	});
});

describe("monitoring reconnect and resynchronization", () => {
	it("replaces a stale unclaimed pending notice when the new connection has a qualifying arrival", async () => {
		const h = await harness(); await h.run();
		h.mailbox.listIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined }], historyId: "300" } });
		await h.run();
		const previous = await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }); assert(previous);
		const gateway = InboxAddressSchema.parse("gmail-others@read.place");
		await h.connections.createConnection({ userId: USER, gatewayAddress: gateway });
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		assert.deepEqual(await h.run(), [SENDER]);
		const current = await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }); assert(current);
		assert.equal(current.gatewayAddress, gateway);
		assert.equal(current.status, "pending");
		assert.equal(current.mailboxId, previous.mailboxId);
	});
	it("keeps a conservative watermark so mail received during metadata fetching is found after history expiration", async () => {
		const h = await harness(); await h.run();
		h.mailbox.listIncomingMessageSenders = async () => {
			h.advance(10_000);
			return { ok: true, value: { ...EMPTY, historyId: "300" } };
		};
		await h.run();
		assert.equal((await h.state()).lastCheckedAt, NOW);
		let expired = true;
		h.mailbox.listIncomingMessageSenders = async () => {
			if (expired) { expired = false; return { ok: false, reason: "history-expired" }; }
			return { ok: true, value: { ...EMPTY, historyId: "400" } };
		};
		h.mailbox.listCurrentIncomingMessageSenders = async () => ({ ok: true, value: { ...EMPTY, senders: [{ email: SENDER, name: undefined, lastMessageAt: NOW + 5_000 }] } });
		assert.deepEqual(await h.run(), [SENDER]);
	});
});

describe("monitoring connection fences", () => {
	it("does not revoke a replacement connection after the prior credentials fail", async () => {
		const h = await harness();
		h.mailbox.findProfile = async () => {
			h.advance(1_000);
			await h.connections.clearRevoked({ userId: USER });
			return { ok: false, reason: "reauth-required" };
		};
		assert.deepEqual(await h.run(), []);
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedAt, undefined);
	});
});
