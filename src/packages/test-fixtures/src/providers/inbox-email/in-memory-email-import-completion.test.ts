import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { InboxAddressSchema, ISSUE_OUTPUT_KEY, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryEmailImportCompletion } from "./in-memory-email-import-completion";
import { initInMemoryInboxEmail } from "./in-memory-inbox-email";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const receivedAtMessageId = "2026-10-27T00:00:00.000Z#<m@example.com>";
const origin = { kind: "history" as const, accountEmail: GmailAccountEmailSchema.parse("a@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };
const selection = { outputs: [ISSUE_OUTPUT_KEY], truncated: false, selectedAt: "2026-10-27T00:00:01.000Z" };

async function withEmail() {
	const emails = initInMemoryInboxEmail();
	await emails.putEmail({
		userId,
		receivedAtMessageId,
		messageId: MessageIdSchema.parse("<m@example.com>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly",
		status: "received",
		receivedAt: "2026-10-27T00:00:00.000Z",
		rawEmailS3Key: "inbound/m",
		bodyS3Key: "content/m",
		linkCounts: undefined,
	});
	return initInMemoryEmailImportCompletion({ getEmail: emails.getEmail, listEmailsByUserId: emails.listEmailsByUserId });
}

describe("initInMemoryEmailImportCompletion", () => {
	it("keeps the first selection and later acknowledgements", async () => {
		const completion = await withEmail();
		await completion.addGmailOrigins({ userId, receivedAtMessageId, origins: [] });
		await completion.addGmailOrigins({ userId, receivedAtMessageId, origins: [origin, origin] });
		assert.deepEqual(await completion.selectOutputs({ userId, receivedAtMessageId, selection }), selection);
		assert.deepEqual(await completion.selectOutputs({ userId, receivedAtMessageId, selection: { ...selection, outputs: [] } }), selection);
		await completion.acknowledgeOutput({ userId, receivedAtMessageId, output: ISSUE_OUTPUT_KEY });
		assert.deepEqual(await completion.findCompletion({ userId, receivedAtMessageId }), { selection, savedOutputs: new Set(["issue"]), origins: [origin] });
	});

	it("tracks nothing for an email that does not exist", async () => {
		const emails = initInMemoryInboxEmail();
		const completion = initInMemoryEmailImportCompletion({ getEmail: async () => undefined, listEmailsByUserId: emails.listEmailsByUserId });
		await completion.acknowledgeOutput({ userId, receivedAtMessageId, output: ISSUE_OUTPUT_KEY });
		assert.equal(await completion.findCompletion({ userId, receivedAtMessageId }), undefined);
		await assert.rejects(completion.addGmailOrigins({ userId, receivedAtMessageId, origins: [origin] }));
		await assert.rejects(completion.selectOutputs({ userId, receivedAtMessageId, selection }));
	});

	it("lists the emails received before a point with their tracking, newest first", async () => {
		const completion = await withEmail();
		await completion.addGmailOrigins({ userId, receivedAtMessageId, origins: [origin] });
		assert.deepEqual(await completion.listCompletionsBefore({ userId, before: "2026-10-28", limit: 1 }), {
			emails: [
				{
					receivedAtMessageId,
					messageId: "<m@example.com>",
					senderEmail: "news@example.com",
					status: "received",
					gmailDestinationAddresses: undefined,
					gmailDeliveryMode: undefined,
					selection: undefined,
					savedOutputs: new Set(),
					origins: [origin],
				},
			],
			exhausted: true,
		});
	});

	it("reports more to read when older emails remain past the limit", async () => {
		const emails = initInMemoryInboxEmail();
		for (const id of ["a", "b"]) {
			await emails.putEmail({
				userId,
				receivedAtMessageId: `2026-10-27T00:00:00.000Z#<${id}@example.com>`,
				messageId: MessageIdSchema.parse(`<${id}@example.com>`),
				recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
				senderEmail: "news@example.com",
				subject: "Weekly",
				status: "received",
				receivedAt: "2026-10-27T00:00:00.000Z",
				rawEmailS3Key: "inbound/m",
				bodyS3Key: "content/m",
				linkCounts: undefined,
			});
		}
		const completion = initInMemoryEmailImportCompletion({ getEmail: emails.getEmail, listEmailsByUserId: emails.listEmailsByUserId });
		const listed = await completion.listCompletionsBefore({ userId, before: "2026-10-28", limit: 1 });
		assert.deepEqual({ count: listed.emails.length, exhausted: listed.exhausted }, { count: 1, exhausted: false });
	});
});
