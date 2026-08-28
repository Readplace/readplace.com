import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { RevokeGmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initDisconnectGmail } from "./disconnect-gmail";
import type { RewriteGmailFilterOutcome } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const NOW = new Date("2026-08-27T00:00:00.000Z");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

async function makeHarness(options: {
	rewritten?: RewriteGmailFilterOutcome;
	revoked?: RevokeGmailGrantResult;
	connected?: boolean;
	credentialed?: boolean;
} = {}) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const credentials = initInMemoryGmailCredentials({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });
	const rewrites: string[] = [];
	const revokes: string[] = [];

	if (options.connected !== false) {
		await connections.createConnection({
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
		});
		await connections.markForwardingConfirmed({ userId: USER });
		await senders.addSenderToFilter({ userId: USER, senderEmail: TLDR });
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
		rewriteGmailFilter: async ({ userId }) => {
			rewrites.push(userId);
			return options.rewritten ?? { ok: true, filterId: undefined, senderCount: 0 };
		},
		revokeGmailGrant: async ({ refreshToken }) => {
			revokes.push(refreshToken);
			return options.revoked ?? { ok: true };
		},
		logger: HutchLogger.from(noopLogger),
	});

	return { disconnect, connections, credentials, senders, rewrites, revokes };
}

describe("initDisconnectGmail", () => {
	it("clears the senders, removes the filter, revokes at Google, then forgets the token", async () => {
		const harness = await makeHarness();

		const result = await harness.disconnect({ userId: USER });

		assert.deepEqual(result, { ok: true, filterRemoved: true, grantRevoked: true });
		assert.deepEqual(await harness.senders.listSendersByUserId(USER), []);
		assert.deepEqual(harness.rewrites, [USER]);
		assert.deepEqual(harness.revokes, ["refresh-1"]);
		assert.equal(await harness.credentials.findRefreshTokenByUserId(USER), undefined);
		const connection = await harness.connections.findConnectionByUserId(USER);
		assert.equal(connection?.revokedReason, "user-disconnected");
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
	});
});
