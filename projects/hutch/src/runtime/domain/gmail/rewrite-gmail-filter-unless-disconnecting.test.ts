import assert from "node:assert/strict";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import type { RewriteGmailFilterOutcome } from "./rewrite-gmail-filter";
import { initRewriteGmailFilterUnlessDisconnecting } from "./rewrite-gmail-filter-unless-disconnecting";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const NOW = new Date("2026-11-08T00:00:00.000Z");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function makeHarness(outcome: RewriteGmailFilterOutcome) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const calls: string[] = [];
	const rewrite = initRewriteGmailFilterUnlessDisconnecting({
		connections,
		rewriteGmailFilter: async ({ userId }) => {
			calls.push(userId);
			return outcome;
		},
	});
	return { rewrite, connections, calls };
}

describe("initRewriteGmailFilterUnlessDisconnecting", () => {
	it("refuses a disconnecting row without touching Gmail", async () => {
		const harness = makeHarness({ ok: true, filterCount: 1, senderCount: 1 });
		await harness.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		await harness.connections.markDisconnectRequested({ userId: USER });

		const result = await harness.rewrite({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-connected" });
		assert.deepEqual(harness.calls, []);
	});

	it("delegates for a connected row and returns its outcome", async () => {
		const harness = makeHarness({ ok: true, filterCount: 1, senderCount: 3 });
		await harness.connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });

		const result = await harness.rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterCount: 1, senderCount: 3 });
		assert.deepEqual(harness.calls, [USER]);
	});

	it("delegates for an absent row", async () => {
		const harness = makeHarness({ ok: false, reason: "not-connected" });

		const result = await harness.rewrite({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "not-connected" });
		assert.deepEqual(harness.calls, [USER]);
	});
});
