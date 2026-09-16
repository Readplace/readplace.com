import assert from "node:assert/strict";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { type DiscoverGmailSenders, GMAIL_DISCOVERY_PAUSED_MESSAGE } from "./discover-gmail-senders";
import { initRunGmailDiscoveryLocally } from "./run-gmail-discovery-locally";

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-09-14T00:00:00.000Z");

type LoggedCall = { level: "info" | "warn" | "error" | "debug"; args: unknown[] };

function capturingLogger() {
	const calls: LoggedCall[] = [];
	const at = (level: LoggedCall["level"]) => (...args: unknown[]) => {
		calls.push({ level, args });
	};
	const logger: HutchLogger = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
	return { calls, logger };
}

const startRunning = (discovery: ReturnType<typeof initInMemoryGmailDiscovery>) =>
	discovery.startDiscovery({
		userId: USER,
		accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
		generation: "run-1",
		mode: "full",
		historyId: "100",
	});

describe("initRunGmailDiscoveryLocally", () => {
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
