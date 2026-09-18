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
const EMPTY_PAGE = { senders: [], nextPageToken: undefined, scannedMessages: 0, estimatedTotalMessages: undefined, newestMessageAt: undefined, oldestMessageAt: undefined };
const NEWEST = Date.parse("2026-09-14T00:00:00.000Z");

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
		listMessageSenders: async (input) => { calls.push({ messages: input }); return { ok: true, value: { senders: [SENDER], nextPageToken: undefined, scannedMessages: 1, estimatedTotalMessages: 1, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } }; },
		listChangedMessageSenders: async (input) => { calls.push({ history: input }); return { ok: true, value: { ...EMPTY_PAGE, historyId: "200" } }; },
	};
	const discover = initDiscoverGmailSenders({ mailbox, connections, discovery, newGeneration: () => `run-${++generation}` });
	async function state() {
		const value = await discovery.findDiscoveryByUserId(USER);
		assert(value);
		return value;
	}
	return { connections, discovery, calls, mailbox, discover, state, advanceClock: (milliseconds: number) => { instant += milliseconds; }, expireClaim: () => { instant += 60_001; } };
}

describe("initDiscoverGmailSenders", () => {
	it("publishes usable full-scan pages, catches up from the opening history checkpoint and refreshes only changes", async () => {
		const h = await harness();
		h.mailbox.listMessageSenders = async (input) => {
			h.calls.push({ messages: input });
			return { ok: true, value: { senders: [SENDER], nextPageToken: input.pageToken === undefined ? "second" : undefined, scannedMessages: 25, estimatedTotalMessages: input.pageToken === undefined ? 100 : 90, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } };
		};
		h.mailbox.listChangedMessageSenders = async (input) => {
			h.calls.push({ history: input });
			return { ok: true, value: { senders: [OTHER_SENDER], nextPageToken: input.pageToken === undefined && input.startHistoryId === "100" ? "more-history" : undefined, scannedMessages: 1, estimatedTotalMessages: undefined, newestMessageAt: NEWEST, oldestMessageAt: NEWEST, historyId: "200" } };
		};
		const first = await h.discover.start(USER);
		assert.deepEqual(first, { userId: USER, generation: "run-1", page: 1 });
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		assert.equal((await h.state()).state, "running");
		assert.equal((await h.state()).estimatedTotalMessages, 100);
		assert(first);
		const second = await h.discover.page(first);
		assert(second);
		assert.equal((await h.state()).mode, "history");
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		const third = await h.discover.page(second);
		assert(third);
		assert.equal((await h.state()).historyId, "100");
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		assert.equal(await h.discover.page(third), undefined);
		assert.equal((await h.state()).historyId, "200");
		assert.equal((await h.state()).scannedCount, 52);
		assert.equal((await h.state()).state, "complete");
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER, OTHER_SENDER]);
		h.calls.length = 0;
		assert.equal(await h.discover.start(USER), undefined);
		assert.deepEqual(h.calls, [{ history: { userId: USER, startHistoryId: "200", pageToken: undefined } }]);
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER, OTHER_SENDER]);
	});

	it("keeps a display name a later full-scan page omits", async () => {
		const h = await harness();
		let calls = 0;
		h.mailbox.listMessageSenders = async (input) => {
			h.calls.push({ messages: input });
			calls += 1;
			return calls === 1
				? { ok: true, value: { senders: [SENDER], nextPageToken: "second", scannedMessages: 25, estimatedTotalMessages: 100, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } }
				: { ok: true, value: { senders: [{ ...SENDER, name: undefined }], nextPageToken: undefined, scannedMessages: 25, estimatedTotalMessages: 90, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } };
		};
		const first = await h.discover.start(USER);
		assert.deepEqual(first, { userId: USER, generation: "run-1", page: 1 });
		assert(first);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		const second = await h.discover.page(first);
		assert.deepEqual(second, { userId: USER, generation: "run-1", page: 2 });
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
	});

	it("ends the full pass once the window is reached and a page holds nothing newer than everything counted, then catches up from the opening checkpoint", async () => {
		const h = await harness();
		let messagePages = 0;
		h.mailbox.listMessageSenders = async (input) => {
			messagePages += 1;
			h.calls.push({ messages: input });
			const newestMessageAt = NEWEST - (messagePages - 1) * 1_000;
			return { ok: true, value: { senders: [SENDER], nextPageToken: `page-${messagePages}`, scannedMessages: 2_000, estimatedTotalMessages: 60_000, newestMessageAt, oldestMessageAt: newestMessageAt - 1_000 } };
		};
		const first = await h.discover.start(USER);
		assert(first);
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 1_000);
		const second = await h.discover.page(first);
		assert(second);
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).pageToken, "page-2");
		assert.equal((await h.state()).scannedCount, 4_000);
		const third = await h.discover.page(second);
		assert(third);
		assert.equal((await h.state()).mode, "history");
		assert.equal((await h.state()).pageToken, undefined);
		assert.equal((await h.state()).scannedCount, 6_000);
		assert.equal((await h.state()).historyId, "100");
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 3_000);
		assert.equal(messagePages, 3);
		assert.equal(await h.discover.page(third), undefined);
		assert.deepEqual(h.calls.at(-1), { history: { userId: USER, startHistoryId: "100", pageToken: undefined } });
		assert.equal((await h.state()).state, "complete");
	});

	it("keeps scanning past the window while pages carry newer mail or no dates to compare", async () => {
		const h = await harness();
		const pages = [
			{ nextPageToken: "page-1", newestMessageAt: NEWEST + 1_000, oldestMessageAt: NEWEST - 10_000 },
			{ nextPageToken: "page-2", newestMessageAt: NEWEST + 2_000, oldestMessageAt: NEWEST - 6_000 },
			{ nextPageToken: "page-3", newestMessageAt: undefined, oldestMessageAt: undefined },
			{ nextPageToken: undefined, newestMessageAt: NEWEST + 4_000, oldestMessageAt: NEWEST - 8_000 },
		];
		h.mailbox.listMessageSenders = async (input) => {
			h.calls.push({ messages: input });
			const next = pages.shift();
			assert(next, "the fake mailbox has no more pages");
			return { ok: true, value: { senders: [SENDER], scannedMessages: 2_500, estimatedTotalMessages: 60_000, ...next } };
		};
		const first = await h.discover.start(USER);
		assert(first);
		const second = await h.discover.page(first);
		assert(second);
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).pageToken, "page-2");
		assert.equal((await h.state()).scannedCount, 5_000);
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 10_000);
		const third = await h.discover.page(second);
		assert(third);
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).pageToken, "page-3");
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 10_000);
		assert(await h.discover.page(third));
		assert.equal((await h.state()).mode, "history");
		assert.equal((await h.state()).scannedCount, 10_000);
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 10_000);
		assert.equal(pages.length, 0);
	});

	it("does not end a scan saved before message dates were tracked until it has a page to compare against", async () => {
		const h = await harness();
		await h.discovery.startDiscovery({ userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "legacy", mode: "full", historyId: "100",
			resume: { page: 3, pageToken: "legacy-cursor", scannedCount: 7_500, estimatedTotalMessages: 60_000, oldestScannedAt: undefined } });
		const pages = [
			{ nextPageToken: "after-legacy", newestMessageAt: NEWEST - 50_000, oldestMessageAt: NEWEST - 51_000 },
			{ nextPageToken: "more", newestMessageAt: NEWEST - 52_000, oldestMessageAt: NEWEST - 53_000 },
		];
		h.mailbox.listMessageSenders = async (input) => {
			h.calls.push({ messages: input });
			const next = pages.shift();
			assert(next, "the fake mailbox has no more pages");
			return { ok: true, value: { senders: [SENDER], scannedMessages: 2_500, estimatedTotalMessages: 60_000, ...next } };
		};
		const resumed = await h.discover.start(USER);
		assert(resumed);
		assert.deepEqual(h.calls, [{ messages: { userId: USER, pageToken: "legacy-cursor" } }]);
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).pageToken, "after-legacy");
		assert.equal((await h.state()).oldestScannedAt, NEWEST - 51_000);
		await h.discover.page(resumed);
		assert.equal((await h.state()).mode, "history");
		assert.equal((await h.state()).scannedCount, 12_500);
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
		assert.equal((await h.state()).scannedCount, 1);
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		h.mailbox.listChangedMessageSenders = async () => ({ ok: false, reason: "history-expired" });
		const restart = await h.discover.page(next);
		assert(restart);
		assert.equal((await h.state()).mode, "profile");
		assert.equal((await h.state()).historyId, undefined);
		assert.equal((await h.state()).scannedCount, 0);
		assert.equal((await h.state()).estimatedTotalMessages, undefined);
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
		h.mailbox.listMessageSenders = async () => ({ ok: true, value: { senders: [SENDER], nextPageToken: "restart-next", scannedMessages: 25, estimatedTotalMessages: 100, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } });
		await h.discover.page(restart);
		assert.equal((await h.state()).historyId, "100");
		assert.equal((await h.state()).mode, "full");
		assert.equal((await h.state()).scannedCount, 25);
		assert.equal((await h.state()).estimatedTotalMessages, 100);
		assert.equal(h.calls.filter((call) => "profile" in (call as object)).length, 2);
	});

	it("retries outages without losing a full-scan cursor and resumes exhausted runs from that cursor", async () => {
		const h = await harness();
		h.mailbox.listMessageSenders = async () => ({ ok: true, value: { senders: [SENDER], nextPageToken: "second", scannedMessages: 25, estimatedTotalMessages: 1_000, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } });
		const next = await h.discover.start(USER);
		assert(next);
		assert.equal((await h.state()).estimatedTotalMessages, 1_000);
		h.mailbox.listMessageSenders = async () => ({ ok: false, reason: "unavailable", status: 503 });
		await assert.rejects(h.discover.page(next), /unavailable \(503\)/);
		assert.equal((await h.state()).state, "running");
		assert.equal((await h.state()).pageToken, "second");
		h.expireClaim();
		h.mailbox.listMessageSenders = async () => ({ ok: false, reason: "rejected", status: 400, message: "bad request" });
		assert.equal(await h.discover.page(next), undefined);
		assert.match((await h.state()).error ?? "", /Try again/);
		assert.equal((await h.state()).estimatedTotalMessages, 1_000);
		h.mailbox.listMessageSenders = async (input) => {
			assert.equal(input.pageToken, "second");
			return { ok: true, value: { senders: [OTHER_SENDER], nextPageToken: "third", scannedMessages: 2, estimatedTotalMessages: 900, newestMessageAt: NEWEST, oldestMessageAt: NEWEST } };
		};
		assert.deepEqual(await h.discover.start(USER), { userId: USER, generation: "run-2", page: 2 });
		assert.equal((await h.state()).scannedCount, 27);
		assert.equal((await h.state()).estimatedTotalMessages, 1_000);
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
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
	});

	it("marks the connection revoked when Google no longer honours the grant during discovery", async () => {
		const h = await harness();
		h.mailbox.findProfile = async () => ({ ok: false, reason: "reauth-required" });

		assert.equal(await h.discover.start(USER), undefined);
		assert.equal((await h.state()).state, "failed");
		assert.equal((await h.state()).requiresReconnect, true);
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
	});

	it("retries a delayed invalid grant without revoking the mailbox that replaced the connection", async () => {
		const h = await harness();
		const replacementGateway = InboxAddressSchema.parse("gmail-b8c3d0@read.place");
		h.mailbox.findProfile = async () => {
			await h.connections.deleteConnection(USER);
			await h.discovery.deleteDiscoveryByUserId(USER);
			await h.connections.createConnection({ userId: USER, gatewayAddress: replacementGateway });
			await h.connections.recordAccountEmail({ userId: USER, accountEmail: OTHER_ACCOUNT });
			await h.discovery.startDiscovery({ userId: USER, accountEmail: OTHER_ACCOUNT, gatewayAddress: replacementGateway, generation: "replacement", mode: "profile", historyId: undefined });
			return { ok: false, reason: "reauth-required" };
		};

		await assert.rejects(h.discover.start(USER), /connection changed during sender discovery/);
		const connection = await h.connections.findConnectionByUserId(USER);
		assert.equal(connection?.accountEmail, OTHER_ACCOUNT);
		assert.equal(connection?.revokedAt, undefined);
		assert.equal(await h.connections.countConnected(), 1);
		assert.equal((await h.state()).generation, "replacement");
		assert.equal((await h.state()).state, "running");
		assert.equal((await h.state()).requiresReconnect, false);
		assert.equal(await h.discover.page({ userId: USER, generation: "run-1", page: 0 }), undefined);
	});

	it("resumes immediately when the same mailbox reconnects while the old page is claimed", async () => {
		const h = await harness();
		const findProfile = h.mailbox.findProfile;
		h.mailbox.findProfile = async () => {
			h.advanceClock(1);
			await h.connections.clearRevoked({ userId: USER });
			await h.discovery.clearRequiresReconnect({ userId: USER, generation: "reconnected" });
			h.mailbox.findProfile = findProfile;
			assert.deepEqual(await h.discover.start(USER), { userId: USER, generation: "reconnected", page: 1 });
			return { ok: false, reason: "reauth-required" };
		};

		await assert.rejects(h.discover.start(USER), /connection changed during sender discovery/);
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedAt, undefined);
		assert.equal((await h.state()).requiresReconnect, false);
		assert.equal((await h.state()).state, "running");

		assert.equal(await h.discover.page({ userId: USER, generation: "run-1", page: 0 }), undefined);
		assert.equal(await h.discover.page({ userId: USER, generation: "reconnected", page: 1 }), undefined);
		assert.equal((await h.state()).state, "complete");
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
	});

	it("does not restore the reconnect prompt when consent completes between revocation and discovery failure", async () => {
		const h = await harness();
		const findProfile = h.mailbox.findProfile;
		h.mailbox.findProfile = async () => ({ ok: false, reason: "reauth-required" });
		const failDiscovery = h.discovery.failDiscovery;
		h.discovery.failDiscovery = async (input) => {
			assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
			h.advanceClock(1);
			await h.connections.clearRevoked({ userId: USER });
			await h.discovery.clearRequiresReconnect({ userId: USER, generation: "reconnected" });
			await failDiscovery(input);
		};

		assert.equal(await h.discover.start(USER), undefined);
		assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedAt, undefined);
		assert.equal((await h.state()).requiresReconnect, false);
		assert.equal((await h.state()).generation, "reconnected");
		assert.equal((await h.state()).state, "running");

		h.mailbox.findProfile = findProfile;
		const next = await h.discover.start(USER);
		assert(next);
		assert.deepEqual(next, { userId: USER, generation: "reconnected", page: 1 });
		assert.equal(await h.discover.page(next), undefined);
		assert.equal((await h.state()).state, "complete");
		assert.deepEqual(await h.discovery.listSendersByUserId(USER), [SENDER]);
	});

	it("does not recreate a connection removed while Gmail is responding", async () => {
		const h = await harness();
		h.mailbox.findProfile = async () => {
			await h.connections.deleteConnection(USER);
			await h.discovery.deleteDiscoveryByUserId(USER);
			return { ok: false, reason: "reauth-required" };
		};

		await assert.rejects(h.discover.start(USER), /connection changed during sender discovery/);
		assert.equal(await h.connections.findConnectionByUserId(USER), undefined);
		assert.equal(await h.discovery.findDiscoveryByUserId(USER), undefined);
		assert.equal(await h.discover.page({ userId: USER, generation: "run-1", page: 0 }), undefined);
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
