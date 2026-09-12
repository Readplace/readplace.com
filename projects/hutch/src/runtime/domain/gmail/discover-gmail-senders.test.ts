import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailMailbox } from "@packages/provider-contracts/gmail-mailbox";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { initDiscoverGmailSenders, initRunGmailDiscovery } from "./discover-gmail-senders";

const USER = UserIdSchema.parse("user-1");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const OTHER_ACCOUNT = GmailAccountEmailSchema.parse("other@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const SENDER = { email: ForwardableSenderSchema.parse("sender@example.com"), name: "Sender" };
const OTHER_SENDER = { email: ForwardableSenderSchema.parse("other@example.com"), name: undefined };
const NOW = new Date("2026-09-12T00:00:00.000Z");
const EMPTY_PAGE = { senders: [], nextPageToken: undefined, scannedMessages: 0 };

async function harness() {
	let instant = NOW.getTime();
	let generation = 0;
	const connections = initInMemoryGmailConnection({ now: () => new Date(instant) });
	const discovery = initInMemoryGmailDiscovery({ now: () => new Date(instant) });
	await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
	await connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
	const calls: unknown[] = [];
	const mailbox: GmailMailbox = {
		findProfile: async (input) => { calls.push({ profile: input }); return { ok: true, value: { accountEmail: ACCOUNT, historyId: "100" } }; },
		listMessageSenders: async (input) => { calls.push({ messages: input }); return { ok: true, value: { senders: [SENDER], nextPageToken: undefined, scannedMessages: 1 } }; },
		listChangedMessageSenders: async (input) => { calls.push({ history: input }); return { ok: true, value: { ...EMPTY_PAGE, historyId: "200" } }; },
	};
	const discover = initDiscoverGmailSenders({ mailbox, connections, discovery, newGeneration: () => `run-${++generation}` });
	async function state() {
		const value = await discovery.findDiscoveryByUserId(USER);
		assert(value);
		return value;
	}
	return { connections, discovery, calls, mailbox, discover, state, expireClaim: () => { instant += 60_001; } };
}

describe("initDiscoverGmailSenders", () => {
	it("publishes usable full-scan pages, catches up from the opening history checkpoint and refreshes only changes", async () => {
		const h = await harness();
		h.mailbox.listMessageSenders = async (input) => {
			h.calls.push({ messages: input });
			return { ok: true, value: { senders: [SENDER], nextPageToken: input.pageToken === undefined ? "second" : undefined, scannedMessages: 25 } };
		};
		h.mailbox.listChangedMessageSenders = async (input) => {
			h.calls.push({ history: input });
			return { ok: true, value: { senders: [OTHER_SENDER], nextPageToken: input.pageToken === undefined && input.startHistoryId === "100" ? "more-history" : undefined, scannedMessages: 1, historyId: "200" } };
		};
		const first = await h.discover.start(USER);
		assert.deepEqual(first, { userId: USER, generation: "run-1", page: 1 });
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		assert.equal((await h.state()).state, "running");
		assert(first);
		const second = await h.discover.page(first);
		assert(second);
		assert.equal((await h.state()).mode, "history");
		const third = await h.discover.page(second);
		assert(third);
		assert.equal((await h.state()).historyId, "100");
		assert.equal(await h.discover.page(third), undefined);
		assert.equal((await h.state()).historyId, "200");
		assert.equal((await h.state()).scannedCount, 52);
		assert.equal((await h.state()).state, "complete");
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER, OTHER_SENDER]);
		h.calls.length = 0;
		assert.equal(await h.discover.start(USER), undefined);
		assert.deepEqual(h.calls, [{ history: { userId: USER, startHistoryId: "200", pageToken: undefined } }]);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER, OTHER_SENDER]);
	});

	it("replays a committed continuation without scanning its messages again and suppresses overlapping claims", async () => {
		const h = await harness();
		const next = await h.discover.start(USER);
		assert(next);
		const calls = h.calls.length;
		assert.deepEqual(await h.discover.page({ ...next, page: 0 }), next);
		assert.equal(h.calls.length, calls);
		assert.equal(await h.discovery.claimPage(next), true);
		assert.equal(await h.discover.start(USER), undefined);
		assert.equal(h.calls.length, calls);
		h.expireClaim();
		assert.equal(await h.discover.page(next), undefined);
		assert.equal(await h.discover.page({ ...next, page: 0 }), undefined);
	});

	it("does not start discovery without a usable connected account", async () => {
		const h = await harness();
		await h.connections.deleteConnection(USER);
		assert.equal(await h.discover.start(USER), undefined);
		assert.equal(await h.discover.page({ userId: USER, generation: "absent", page: 0 }), undefined);
		await h.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		assert.equal(await h.discover.start(USER), undefined);
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
		await h.connections.markDisconnectRequested({ userId: USER });
		assert.equal(await h.discover.start(USER), undefined);
		assert.deepEqual(h.calls, []);
	});

	it("cleans up a late discovery start after account deletion or a disconnect request", async () => {
		for (const disconnecting of [false, true]) {
			const h = await harness();
			const next = await h.discover.start(USER);
			assert(next);
			if (disconnecting) await h.connections.markDisconnectRequested({ userId: USER });
			else await h.connections.deleteConnection(USER);
			assert.equal(await h.discover.page(next), undefined);
			assert.equal(await h.discovery.findDiscoveryByUserId(USER), undefined);
			assert.deepEqual(await h.discovery.listSendersByUserId(USER), []);
		}
		const h = await harness();
		const start = h.discovery.startDiscovery;
		h.discovery.startDiscovery = async (input) => {
			await h.connections.deleteConnection(USER);
			await h.discovery.deleteDiscoveryByUserId(USER);
			return start(input);
		};
		assert.equal(await h.discover.start(USER), undefined);
		assert.equal(await h.discovery.findDiscoveryByUserId(USER), undefined);
		assert.deepEqual(h.calls, []);
		const erased = await harness();
		const startBeforeErasure = erased.discovery.startDiscovery;
		erased.discovery.startDiscovery = async (input) => {
			const started = await startBeforeErasure(input);
			await erased.connections.deleteConnection(USER);
			await erased.discovery.deleteDiscoveryByUserId(USER);
			return started;
		};
		assert.equal(await erased.discover.start(USER), undefined);
		assert.deepEqual(erased.calls, []);
	});

	it("fences old account, gateway and generation deliveries without deleting the current cache", async () => {
		const h = await harness();
		const next = await h.discover.start(USER);
		assert(next);
		assert.equal(await h.discover.page({ ...next, generation: "old" }), undefined);
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: OTHER_ACCOUNT });
		assert.equal(await h.discover.page(next), undefined);
		await h.connections.createConnection({ userId: USER, gatewayAddress: InboxAddressSchema.parse("gmail-b8c3d0@read.place") });
		assert.equal(await h.discover.page(next), undefined);
		await h.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		assert.equal(await h.discover.page(next), undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		assert.equal((await h.state()).generation, next.generation);
	});

	it("starts a fresh cache when the Gmail account or gateway changes", async () => {
		for (const changeAccount of [true, false]) {
			const h = await harness();
			await h.discover.start(USER);
			const accountEmail = changeAccount ? OTHER_ACCOUNT : ACCOUNT;
			await h.connections.createConnection({ userId: USER, gatewayAddress: changeAccount ? GATEWAY : InboxAddressSchema.parse("gmail-b8c3d0@read.place") });
			await h.connections.recordAccountEmail({ userId: USER, accountEmail });
			h.mailbox.findProfile = async () => ({ ok: true, value: { accountEmail, historyId: "300" } });
			h.mailbox.listMessageSenders = async () => ({ ok: true, value: EMPTY_PAGE });
			const next = await h.discover.start(USER);
			assert.equal(next?.generation, "run-2");
			assert.deepEqual(await h.discovery.listSendersByUserId(USER), []);
		}
	});

	it("accepts an existing mixed-case account identity but rejects another mailbox's metadata", async () => {
		const h = await harness();
		await h.connections.recordAccountEmail({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("Reader@Gmail.com") });
		const next = await h.discover.start(USER);
		assert(next);
		assert.equal(await h.discover.start(USER), undefined);
		assert.equal((await h.state()).state, "complete");
		await h.discovery.deleteDiscoveryByUserId(USER);
		h.mailbox.findProfile = async () => ({ ok: true, value: { accountEmail: OTHER_ACCOUNT, historyId: "300" } });
		assert.equal(await h.discover.start(USER), undefined);
		assert.match((await h.state()).error ?? "", /Reconnect the Gmail account/);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), []);
	});

	it("keeps the cache usable and restarts full discovery when the history checkpoint expires", async () => {
		const h = await harness();
		const next = await h.discover.start(USER);
		assert(next);
		h.mailbox.listChangedMessageSenders = async () => ({ ok: false, reason: "history-expired" });
		const restart = await h.discover.page(next);
		assert(restart);
		assert.equal((await h.state()).mode, "profile");
		assert.equal((await h.state()).historyId, undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		await h.discover.page(restart);
		assert.equal((await h.state()).historyId, "100");
		assert.equal(h.calls.filter((call) => "profile" in (call as object)).length, 2);
	});

	it("retries outages without losing a full-scan cursor and resumes exhausted runs from that cursor", async () => {
		const h = await harness();
		h.mailbox.listMessageSenders = async () => ({ ok: true, value: { senders: [SENDER], nextPageToken: "second", scannedMessages: 25 } });
		const next = await h.discover.start(USER);
		assert(next);
		h.mailbox.listMessageSenders = async () => ({ ok: false, reason: "unavailable", status: 503 });
		await assert.rejects(h.discover.page(next), /unavailable \(503\)/);
		assert.equal((await h.state()).state, "running");
		assert.equal((await h.state()).pageToken, "second");
		h.expireClaim();
		h.mailbox.listMessageSenders = async () => ({ ok: false, reason: "rejected", status: 400, message: "bad request" });
		assert.equal(await h.discover.page(next), undefined);
		assert.match((await h.state()).error ?? "", /Try again/);
		h.mailbox.listMessageSenders = async (input) => {
			assert.equal(input.pageToken, "second");
			return { ok: true, value: { senders: [OTHER_SENDER], nextPageToken: undefined, scannedMessages: 2 } };
		};
		assert.deepEqual(await h.discover.start(USER), { userId: USER, generation: "run-2", page: 2 });
		assert.equal((await h.state()).scannedCount, 27);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER, OTHER_SENDER]);
	});

	it("asks for reconnect on missing metadata permission without revoking forwarding and resumes after consent", async () => {
		const h = await harness();
		h.mailbox.findProfile = async () => ({ ok: false, reason: "metadata-permission-required" });
		assert.equal(await h.discover.start(USER), undefined);
		assert.equal((await h.state()).state, "failed");
		assert.match((await h.state()).error ?? "", /Reconnect/);
		assert.equal((await h.state()).requiresReconnect, true);
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedAt, undefined);
		h.mailbox.findProfile = async () => ({ ok: true, value: { accountEmail: ACCOUNT, historyId: "300" } });
		const next = await h.discover.start(USER);
		assert(next);
		assert.equal((await h.state()).requiresReconnect, false);
		h.mailbox.listChangedMessageSenders = async () => ({ ok: false, reason: "reauth-required" });
		assert.equal(await h.discover.page(next), undefined);
		assert.equal((await h.state()).state, "failed");
	});

	it("does not continue if another lifecycle operation removed the committed state", async () => {
		const h = await harness();
		const save = h.discovery.savePage;
		h.discovery.savePage = async (input) => {
			await h.discovery.deleteDiscoveryByUserId(USER);
			return save(input);
		};
		assert.equal(await h.discover.start(USER), undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), []);
	});

	it("asserts a malformed non-profile checkpoint cannot run without a history baseline", async () => {
		const h = await harness();
		await h.discovery.startDiscovery({ userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "broken", mode: "history", historyId: undefined });
		await assert.rejects(h.discover.start(USER), /history baseline/);
	});
});

describe("initRunGmailDiscovery", () => {
	it("paces real provider pages in development until discovery completes", async () => {
		const h = await harness();
		let waits = 0;
		await initRunGmailDiscovery({ discover: h.discover, waitForNextPage: async () => { waits += 1; } })({ userId: USER });
		assert.equal(waits, 1);
		assert.equal((await h.state()).state, "complete");
		await initRunGmailDiscovery({ discover: h.discover, waitForNextPage: async () => { waits += 1; } })({ userId: USER });
		assert.equal(waits, 1);
	});
});
