import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type GmailMessageOrigin, GmailMessageIdSchema } from "@packages/domain/gmail";
import { InboxAddressSchema, type InboxEmailEntry, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	initInMemoryEmailImportCompletion,
	initInMemoryInboxEmail,
	initInMemoryInboxEmailLink,
} from "@packages/test-fixtures/providers/inbox-email";
import { initRecordDuplicateGmailOrigin } from "../gmail-import-completion/record-gmail-origin";
import { initSettleExtractedEmail } from "./settle-extracted-email";

const userId = UserIdSchema.parse("reader");
const address = InboxAddressSchema.parse("work-abc123@read.place");
const receivedAtMessageId = "2026-10-04T00:00:00.000Z#<issue@sender>";
const rawEmailS3Key = "inbound/original";
const gmailOrigin: GmailMessageOrigin = {
	kind: "history",
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("m1"),
	senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
};

const receivedRow = (overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry => ({
	userId,
	receivedAtMessageId,
	recipientAddress: address,
	messageId: MessageIdSchema.parse("<issue@sender>"),
	senderEmail: "news@sender",
	subject: "News",
	status: "received",
	receivedAt: "2026-10-04T00:00:00.000Z",
	rawEmailS3Key,
	bodyS3Key: "content/body",
	linkCounts: undefined,
	...overrides,
});

function makeSettle() {
	const emails = initInMemoryInboxEmail();
	const links = initInMemoryInboxEmailLink();
	const completions = initInMemoryEmailImportCompletion({
		getEmail: emails.getEmail,
		listEmailsByUserId: emails.listEmailsByUserId,
	});
	const evaluations: unknown[] = [];
	const settle = initSettleExtractedEmail({
		getEmail: emails.getEmail,
		findLinksMeta: links.findLinksMeta,
		recordDuplicateGmailOrigin: initRecordDuplicateGmailOrigin({
			addGmailOrigins: completions.addGmailOrigins,
			evaluate: async (input) => {
				evaluations.push(input);
				return "not-saved";
			},
		}),
	});
	const finishExtraction = (extractionFailed: boolean) =>
		links.putLinksMeta({ userId, receivedAtMessageId, meta: { truncated: false, extractionFailed } });
	const origins = async () => (await completions.findCompletion({ userId, receivedAtMessageId }))?.origins;
	return { emails, settle, finishExtraction, evaluations, origins };
}

describe("initSettleExtractedEmail", () => {
	it("settles a received email whose extraction finished, and records its origin", async () => {
		const { emails, settle, finishExtraction, evaluations, origins } = makeSettle();
		await emails.putEmail(receivedRow({ gmailDestinationAddresses: [address] }));
		await finishExtraction(false);

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: true, gmailOrigin }), true);
		assert.deepEqual(await origins(), [gmailOrigin]);
		assert.deepEqual(evaluations, [{ userId, receivedAtMessageId }]);
	});

	it("settles without recording when the delivery carries no Gmail origin", async () => {
		const { emails, settle, finishExtraction, evaluations, origins } = makeSettle();
		await emails.putEmail(receivedRow());
		await finishExtraction(false);

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: false, gmailOrigin: undefined }), true);
		assert.deepEqual(await origins(), []);
		assert.deepEqual(evaluations, []);
	});

	it("hands a failed extraction back to the normal path", async () => {
		const { emails, settle, finishExtraction } = makeSettle();
		await emails.putEmail(receivedRow());
		await finishExtraction(true);

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: false, gmailOrigin: undefined }), false);
	});

	it("hands an email with no extraction barrier back to the normal path", async () => {
		const { emails, settle } = makeSettle();
		await emails.putEmail(receivedRow());

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: false, gmailOrigin: undefined }), false);
	});

	it("does not settle a different raw email under the same key", async () => {
		const { emails, settle, finishExtraction } = makeSettle();
		await emails.putEmail(receivedRow());
		await finishExtraction(false);

		assert.equal(
			await settle({ userId, receivedAtMessageId, rawEmailS3Key: "inbound/another-attempt", deliversGmail: false, gmailOrigin: undefined }),
			false,
		);
	});

	it("does not settle an unparsed row", async () => {
		const { emails, settle, finishExtraction } = makeSettle();
		await emails.putEmail(receivedRow({ status: "unparsed", bodyS3Key: undefined }));
		await finishExtraction(false);

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: false, gmailOrigin: undefined }), false);
	});

	it("does not settle when there is no row", async () => {
		const { settle } = makeSettle();

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: false, gmailOrigin: undefined }), false);
	});

	it("does not settle a Gmail recipient on a row with no Gmail routing", async () => {
		const { emails, settle, finishExtraction, evaluations, origins } = makeSettle();
		await emails.putEmail(receivedRow());
		await finishExtraction(false);
		const before = await origins();

		assert.equal(await settle({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail: true, gmailOrigin }), false);
		assert.deepEqual(await origins(), before);
		assert.deepEqual(evaluations, []);
	});
});
