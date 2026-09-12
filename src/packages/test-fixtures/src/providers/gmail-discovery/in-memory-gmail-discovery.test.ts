import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailDiscovery } from "./in-memory-gmail-discovery";

const USER = UserIdSchema.parse("user-1");
const EMAIL = ForwardableSenderSchema.parse("sender@example.com");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const NOW = new Date("2026-09-12T00:00:00.000Z");
const START = { userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "run-1", mode: "profile", historyId: undefined } as const;

describe("initInMemoryGmailDiscovery", () => {
	it("deduplicates pages, preserves names and resumes without clearing cached senders", async () => {
		const store = initInMemoryGmailDiscovery({ now: () => NOW });
		assert.equal(await store.findDiscoveryByUserId(USER), undefined);
		assert.deepEqual(await store.listSendersByUserId(USER), []);
		assert.equal(await store.startDiscovery(START), true);
		assert.equal(await store.startDiscovery({ ...START, generation: "duplicate" }), false);
		const previous = await store.findDiscoveryByUserId(USER);
		assert(previous);
		const page = { previous, senders: [{ email: EMAIL, name: "Sender" }], mode: "history", pageToken: undefined, historyId: "100", state: "complete", scannedMessages: 25 } as const;
		assert.equal(await store.savePage(page), true);
		assert.equal(await store.savePage(page), false);
		assert.equal((await store.findDiscoveryByUserId(USER))?.scannedCount, 25);
		assert.equal(await store.startDiscovery({ ...START, generation: "run-2", mode: "history", historyId: "100" }), true);
		const refreshed = await store.findDiscoveryByUserId(USER);
		assert(refreshed);
		await store.savePage({ ...page, previous: refreshed, senders: [{ email: EMAIL, name: "New name" }] });
		assert.deepEqual(await store.listSendersByUserId(USER), [{ email: EMAIL, name: "New name" }]);
		await store.failDiscovery({ userId: USER, generation: "run-2", error: "late failure" });
		assert.equal((await store.findDiscoveryByUserId(USER))?.state, "complete");
	});

	it("claims one page at a time and releases expired claims for redelivery", async () => {
		let instant = NOW.getTime();
		const store = initInMemoryGmailDiscovery({ now: () => new Date(instant) });
		const claim = { userId: USER, generation: "run-1", page: 0 };
		assert.equal(await store.claimPage(claim), false);
		await store.startDiscovery(START);
		assert.equal(await store.claimPage({ ...claim, generation: "other" }), false);
		assert.equal(await store.claimPage({ ...claim, page: 2 }), false);
		assert.equal(await store.claimPage(claim), true);
		assert.equal(await store.claimPage(claim), false);
		instant += 60_001;
		assert.equal(await store.claimPage(claim), true);
		await store.failDiscovery({ userId: USER, generation: "other", error: "old" });
		await store.failDiscovery({ userId: USER, generation: "run-1", error: "Try again", requiresReconnect: true });
		assert.equal((await store.findDiscoveryByUserId(USER))?.error, "Try again");
		assert.equal((await store.findDiscoveryByUserId(USER))?.requiresReconnect, true);
		assert.equal(await store.claimPage(claim), false);
		await store.startDiscovery({ ...START, generation: "resumed", resume: { page: 4, pageToken: "resume", scannedCount: 100 } });
		const resumed = await store.findDiscoveryByUserId(USER);
		assert.equal(resumed?.page, 4);
		assert.equal(resumed?.pageToken, "resume");
		assert.equal(resumed?.scannedCount, 100);
		assert.equal(resumed?.requiresReconnect, false);
	});

	it("rejects stale saves and cannot recreate sender data after deletion", async () => {
		const store = initInMemoryGmailDiscovery({ now: () => NOW });
		await store.startDiscovery(START);
		const previous = await store.findDiscoveryByUserId(USER);
		assert(previous);
		const page = { previous, senders: [{ email: EMAIL, name: undefined }], mode: "full", pageToken: "next", historyId: "100", state: "running", scannedMessages: 1 } as const;
		assert.equal(await store.savePage({ ...page, previous: { ...previous, generation: "old" } }), false);
		assert.equal(await store.savePage({ ...page, previous: { ...previous, page: 3 } }), false);
		await store.failDiscovery({ userId: USER, generation: previous.generation, error: "failed" });
		assert.equal(await store.savePage(page), false);
		await store.deleteDiscoveryByUserId(USER);
		assert.equal(await store.savePage(page), false);
		assert.deepEqual(await store.listSendersByUserId(USER), []);
		assert.equal(await store.findDiscoveryByUserId(USER), undefined);
		await store.failDiscovery({ userId: USER, generation: "run-1", error: "late" });
		await store.deleteDiscoveryByUserId(USER);
	});
});
