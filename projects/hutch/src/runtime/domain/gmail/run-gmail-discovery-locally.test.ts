import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type { GmailMailbox } from "@packages/provider-contracts/gmail-mailbox";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { type DiscoverGmailSenders, GMAIL_DISCOVERY_PAUSED_MESSAGE, initDiscoverGmailSenders } from "./discover-gmail-senders";
import { initRunGmailDiscoveryLocally } from "./run-gmail-discovery-locally";

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-09-14T00:00:00.000Z");

type LoggedCall = { level: "info" | "warn" | "error" | "debug"; args: unknown[] };

function capturingLogger() {
	const calls: LoggedCall[] = [];
	const at = (level: LoggedCall["level"]) => (...args: unknown[]) => {
		calls.push({ level, args });
	};
	const logger: Logger = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
	return { calls, logger };
}

const startRunning = (discovery: ReturnType<typeof initInMemoryGmailDiscovery>) =>
	discovery.startDiscovery({
		checkedMessageCount: 0,
		userId: USER,
		accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
		generation: "run-1",
		mode: "full",
		historyId: "100",
	});

describe("initRunGmailDiscoveryLocally", () => {
	it("paces real provider pages in development until discovery completes", async () => {
		const account = GmailAccountEmailSchema.parse("reader@gmail.com");
		const newest = Date.parse("2026-09-14T00:00:00.000Z");
		const connections = initInMemoryGmailConnection({ now: () => NOW });
		const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
		await connections.createConnection({ userId: USER, gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place") });
		await connections.recordAccountEmail({ userId: USER, accountEmail: account });
		const mailbox: GmailMailbox = {
			findProfile: async () => ({ ok: true, value: { accountEmail: account, historyId: "100" } }),
			listMessageSenders: async () => ({ ok: true, value: { senders: [{ email: ForwardableSenderSchema.parse("sender@example.com"), name: "Sender" }], nextPageToken: undefined, scannedMessages: 1, estimatedTotalMessages: 1, newestMessageAt: newest, oldestMessageAt: newest } }),
			listChangedMessageSenders: async () => ({ ok: true, value: { senders: [], nextPageToken: undefined, scannedMessages: 0, estimatedTotalMessages: undefined, newestMessageAt: undefined, oldestMessageAt: undefined, historyId: "200" } }),
		};
		let generation = 0;
		const discover = initDiscoverGmailSenders({ mailbox, connections, discovery, newGeneration: () => `run-${++generation}` });
		const { calls, logger } = capturingLogger();
		let waits = 0;
		const run = initRunGmailDiscoveryLocally({ discover, discovery, waitForNextPage: async () => { waits += 1; }, logger });

		await run({ userId: USER });
		assert.equal(waits, 1);
		assert.equal((await discovery.findDiscoveryByUserId(USER))?.state, "complete");
		await run({ userId: USER });
		assert.equal(waits, 1);
		assert.deepEqual(calls, []);
	});

	it("records nothing and does not log when a run completes", async () => {
		const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
		const discover: DiscoverGmailSenders = { start: async () => undefined, page: async () => undefined };
		const { calls, logger } = capturingLogger();

		await initRunGmailDiscoveryLocally({ discover, discovery, waitForNextPage: async () => {}, logger })({ userId: USER });

		assert.equal(await discovery.findDiscoveryByUserId(USER), undefined);
		assert.deepEqual(calls, []);
	});

	it("marks the running checkpoint failed with the shared message and logs when the run throws", async () => {
		const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
		await startRunning(discovery);
		const discover: DiscoverGmailSenders = {
			start: async () => {
				throw new Error("network down");
			},
			page: async () => undefined,
		};
		const { calls, logger } = capturingLogger();

		await initRunGmailDiscoveryLocally({ discover, discovery, waitForNextPage: async () => {}, logger })({ userId: USER });

		const state = await discovery.findDiscoveryByUserId(USER);
		assert.equal(state?.state, "failed");
		assert.equal(state?.error, GMAIL_DISCOVERY_PAUSED_MESSAGE);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.level, "error");
	});

	it("records nothing but still logs when the run throws with no scan running", async () => {
		const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
		const discover: DiscoverGmailSenders = {
			start: async () => {
				throw new Error("network down");
			},
			page: async () => undefined,
		};
		const { calls, logger } = capturingLogger();

		await initRunGmailDiscoveryLocally({ discover, discovery, waitForNextPage: async () => {}, logger })({ userId: USER });

		assert.equal(await discovery.findDiscoveryByUserId(USER), undefined);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.level, "error");
	});
});
