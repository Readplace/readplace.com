import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import {
	type EmailIdentityStore,
	InboxAddressSchema,
	type IngestionAttempt,
	MessageIdSchema,
	messageIdentityKey,
	NormalizedMessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryEmailIdentity } from "@packages/test-fixtures/providers/email-identity";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { initResolveEmailIdentity } from "./resolve-email-identity";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MESSAGE_ID = MessageIdSchema.parse("<issue-42@tldr.tech>");
const NORMALIZED = NormalizedMessageIdSchema.parse("issue-42@tldr.tech");
const KEY = messageIdentityKey({ userId: READER, sender: TLDR, messageId: NORMALIZED });
const NOW = new Date("2026-09-30T00:00:00.000Z");
const FORWARDED_ROW = `2026-09-20T07:31:00.000Z#${MESSAGE_ID}`;
const IMPORTED_ROW = `2026-09-20T07:30:00.000Z#${MESSAGE_ID}`;
const FORWARD: IngestionAttempt = { origin: "receive", sesMessageId: "ses-1" };
const IMPORT: IngestionAttempt = {
	origin: "gmail-import",
	jobId: GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5"),
};

function makeResolver(overrides: Partial<EmailIdentityStore> = {}) {
	const identities = initInMemoryEmailIdentity();
	const emails = initInMemoryInboxEmail();
	const resolveIdentity = initResolveEmailIdentity({
		identities: { ...identities, ...overrides },
		findReceivedByMessageId: emails.findReceivedByMessageId,
		getEmail: emails.getEmail,
		now: () => NOW,
	});
	const resolve = (input: { attempt: IngestionAttempt; proposedReceivedAtMessageId: string }) =>
		resolveIdentity({ userId: READER, sender: TLDR, messageId: MESSAGE_ID, normalizedMessageId: NORMALIZED, ...input });
	const storeRow = (input: { receivedAtMessageId: string; senderEmail: string }) =>
		emails.putEmail({
			userId: READER,
			receivedAtMessageId: input.receivedAtMessageId,
			messageId: MESSAGE_ID,
			recipientAddress: InboxAddressSchema.parse("gmail-abc123@read.place"),
			senderEmail: input.senderEmail,
			subject: "TLDR 2026-09-20",
			status: "received",
			receivedAt: "2026-09-20T07:30:00.000Z",
			rawEmailS3Key: "inbound/earlier",
			bodyS3Key: "content/earlier/content.html",
			linkCounts: undefined,
		});
	return { identities, resolve, storeRow };
}

describe("initResolveEmailIdentity", () => {
	it("lets the first attempt proceed under the row id it proposed", async () => {
		const { identities, resolve } = makeResolver();

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		assert.deepEqual(resolution, { proceed: true, receivedAtMessageId: IMPORTED_ROW });
		assert.deepEqual(await identities.find(KEY), {
			key: KEY,
			userId: READER,
			receivedAtMessageId: IMPORTED_ROW,
			attempt: IMPORT,
			claimedAt: NOW.toISOString(),
		});
	});

	it("lets a retry of the same attempt proceed under the row id it claimed first", async () => {
		const { resolve } = makeResolver();
		await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: "2026-09-21T00:00:00.000Z#other" });

		assert.deepEqual(resolution, { proceed: true, receivedAtMessageId: IMPORTED_ROW });
	});

	it("reports a message another attempt already stored as already ingested", async () => {
		const { resolve, storeRow } = makeResolver();
		await resolve({ attempt: FORWARD, proposedReceivedAtMessageId: FORWARDED_ROW });
		await storeRow({ receivedAtMessageId: FORWARDED_ROW, senderEmail: "dan@tldr.tech" });

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		assert.deepEqual(resolution, { proceed: false, reason: "already-ingested" });
	});

	it("takes over a claim whose attempt never stored its row, keeping the claimed row id", async () => {
		const { identities, resolve } = makeResolver();
		await resolve({ attempt: FORWARD, proposedReceivedAtMessageId: FORWARDED_ROW });

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		assert.deepEqual(resolution, { proceed: true, receivedAtMessageId: FORWARDED_ROW });
		assert.deepEqual((await identities.find(KEY))?.attempt, IMPORT);
	});

	it("fails the attempt when another attempt wins the takeover first", async () => {
		const { resolve } = makeResolver({ takeOver: async () => false });
		await resolve({ attempt: FORWARD, proposedReceivedAtMessageId: FORWARDED_ROW });

		await assert.rejects(resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW }), {
			message: "another ingestion attempt took over this email identity first",
		});
	});

	it("adopts a row stored before identity claims existed as the canonical copy", async () => {
		const { identities, resolve, storeRow } = makeResolver();
		await storeRow({ receivedAtMessageId: FORWARDED_ROW, senderEmail: "Dan@TLDR.tech" });

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		assert.deepEqual(resolution, { proceed: false, reason: "already-ingested" });
		assert.deepEqual(await identities.find(KEY), {
			key: KEY,
			userId: READER,
			receivedAtMessageId: FORWARDED_ROW,
			attempt: { origin: "pre-claim-row" },
			claimedAt: NOW.toISOString(),
		});
	});

	it("never adopts a row with the same Message-ID from a different sender", async () => {
		const { resolve, storeRow } = makeResolver();
		await storeRow({ receivedAtMessageId: FORWARDED_ROW, senderEmail: "someone@else.test" });

		const resolution = await resolve({ attempt: IMPORT, proposedReceivedAtMessageId: IMPORTED_ROW });

		assert.deepEqual(resolution, { proceed: true, receivedAtMessageId: IMPORTED_ROW });
	});
});
