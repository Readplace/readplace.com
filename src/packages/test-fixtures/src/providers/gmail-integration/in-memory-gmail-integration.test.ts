import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailIntegration } from "./in-memory-gmail-integration";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const tldr = ForwardableSenderSchema.parse("dan@tldr.tech");

const GRANT: GmailGrantResult = {
	ok: true,
	grant: {
		refreshToken: "refresh-1",
		accessToken: "access-1",
		grantedScope: GMAIL_SETTINGS_SCOPE,
	},
};

describe("initInMemoryGmailIntegration", () => {
	it("returns the configured grant and records the code it was handed", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT });

		assert.deepEqual(await gmail.bundle.exchangeGmailCode({ code: "auth-code" }), GRANT);
		assert.deepEqual(gmail.exchangedCodes, ["auth-code"]);
	});

	it("mints the gateway address under the reserved alias", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT });

		const address = await gmail.bundle.mintGatewayAddress({ userId: owner });

		assert.match(address, /^gmail-[0-9a-z]{6}@read\.place$/);
	});

	it("names a sender's address after its publication and honours the domain", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, domain: "readplace-staging.com" });

		const address = await gmail.bundle.mintSenderAddress({ userId: owner, senderEmail: tldr });

		assert.match(address, /^tldr-[0-9a-z]{6}@readplace-staging\.com$/);
	});

	it("captures the commands the page would publish", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT });

		await gmail.bundle.publishRewriteGmailFilter({ userId: owner, reason: "sender-added" });
		await gmail.bundle.publishDisconnectGmail({ userId: owner });

		assert.deepEqual(gmail.rewriteRequests, [{ userId: owner, reason: "sender-added" }]);
		assert.deepEqual(gmail.disconnectRequests, [{ userId: owner }]);
	});

	it("shares one clock with the stores it builds", async () => {
		const now = new Date("2026-08-27T00:00:00.000Z");
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, now: () => now });

		const connection = await gmail.bundle.gmailConnectionStore.createConnection({
			userId: owner,
			gatewayAddress: await gmail.bundle.mintGatewayAddress({ userId: owner }),
		});

		assert.equal(connection.connectedAt, now.toISOString());
	});
});
