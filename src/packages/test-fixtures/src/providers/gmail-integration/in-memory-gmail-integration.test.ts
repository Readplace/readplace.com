import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryInboxAddress } from "../inbox-address";
import { initInMemoryGmailIntegration } from "./in-memory-gmail-integration";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const SENDER = ForwardableSenderSchema.parse("news@example.com");

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
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });

		assert.deepEqual(await gmail.bundle.exchangeGmailCode({ code: "auth-code" }), GRANT);
		assert.deepEqual(gmail.exchangedCodes, ["auth-code"]);
	});

	it("mints the gateway address under the reserved alias", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });

		const address = await gmail.bundle.mintGatewayAddress({ userId: owner });

		assert.match(address, /^gmail-[0-9a-z]{6}@read\.place$/);
	});

	it("mints the gateway address under the given domain", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }), domain: "readplace-staging.com" });

		const address = await gmail.bundle.mintGatewayAddress({ userId: owner });

		assert.match(address, /^gmail-[0-9a-z]{6}@readplace-staging\.com$/);
	});

	it("captures the commands the page would publish", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });

		await gmail.bundle.publishRewriteGmailFilter({ userId: owner, reason: "sender-added" });
		await gmail.bundle.publishDisconnectGmail({ userId: owner });
		await gmail.bundle.publishStartGmailSenderDiscovery({ userId: owner });

		assert.deepEqual(gmail.rewriteRequests, [{ userId: owner, reason: "sender-added" }]);
		assert.deepEqual(gmail.disconnectRequests, [{ userId: owner }]);
		assert.deepEqual(gmail.discoveryRequests, [{ userId: owner }]);
	});

	it("shares one clock with the stores it builds", async () => {
		const now = new Date("2026-08-27T00:00:00.000Z");
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => now }), now: () => now });

		const connection = await gmail.bundle.gmailConnectionStore.createConnection({
			userId: owner,
			gatewayAddress: await gmail.bundle.mintGatewayAddress({ userId: owner }),
		});

		assert.equal(connection.connectedAt, now.toISOString());
	});

	it("allocates one readlist address per readlist and releases it on retire", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }), domain: "readplace-staging.com" });
		const readlist = ReadlistSlugSchema.parse("tech");

		const allocated = await gmail.bundle.getOrCreateReadlistAddress({ userId: owner, readlist });
		const found = await gmail.bundle.findReadlistAddress({ userId: owner, readlist });
		const retired = await gmail.bundle.retireReadlistAddress({ userId: owner, readlist });

		assert.match(allocated.address, /^gmail-[0-9a-z]{6}@readplace-staging\.com$/);
		assert.equal(allocated.purpose, "gmail-readlist");
		assert.equal(found?.address, allocated.address);
		assert.equal(retired, allocated.address);
		assert.equal(await gmail.bundle.findReadlistAddress({ userId: owner, readlist }), undefined);
	});

	it("cancels unfinished imports for a sender on the shared clock", async () => {
		const now = new Date("2026-09-30T00:00:00.000Z");
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => now }), now: () => now });
		const jobId = gmail.bundle.newGmailHistoryImportJobId();
		await gmail.bundle.gmailHistoryImportStore.createJob({
			userId: owner,
			jobId,
			senderEmail: SENDER,
			destinationAddresses: [InboxAddressSchema.parse("gmail-abc123@read.place")],
			connection: { gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"), accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") },
			window: undefined,
			generation: gmail.bundle.newGmailHistoryImportGeneration(),
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: "awaiting-permission",
			counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			completedAt: undefined,
		});

		const cancelled = await gmail.bundle.cancelGmailHistoryImports({ userId: owner, senderEmail: SENDER, reason: "mapping-removed" });

		assert.deepEqual(
			cancelled.map((job) => ({ jobId: job.jobId, state: job.state, cancelReason: job.cancelReason, updatedAt: job.updatedAt })),
			[{ jobId, state: "cancelled", cancelReason: "mapping-removed", updatedAt: now.toISOString() }],
		);
	});

	it("issues distinct job ids and generations", () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });

		assert.deepEqual(
			[gmail.bundle.newGmailHistoryImportJobId(), gmail.bundle.newGmailHistoryImportJobId()],
			["00000000000000000000000000000001", "00000000000000000000000000000002"],
		);
		assert.deepEqual(
			[gmail.bundle.newGmailHistoryImportGeneration(), gmail.bundle.newGmailHistoryImportGeneration()],
			["generation-1", "generation-2"],
		);
	});

	it("captures the diagnostic lines written at every level, in order", () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });

		gmail.bundle.diagnosticsLogger.info('{"event":"first"}');
		gmail.bundle.diagnosticsLogger.error('{"event":"second"}');
		gmail.bundle.diagnosticsLogger.warn("third", 3);
		gmail.bundle.diagnosticsLogger.debug("fourth");

		assert.deepEqual(gmail.diagnosticLines, ['{"event":"first"}', '{"event":"second"}', "third 3", "fourth"]);
	});

	it("captures import starts and newsletter sender submissions", async () => {
		const gmail = initInMemoryGmailIntegration({ grant: GRANT, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });
		const jobId = gmail.bundle.newGmailHistoryImportJobId();

		await gmail.bundle.publishStartGmailHistoryImport({ userId: owner, jobId, generation: "generation-1" });
		await gmail.bundle.publishSubmitNewsletterSender({ senderEmail: SENDER });

		assert.deepEqual(gmail.importStartRequests, [{ userId: owner, jobId, generation: "generation-1" }]);
		assert.deepEqual(gmail.newsletterSenderSubmissions, [{ senderEmail: SENDER }]);
	});
});
