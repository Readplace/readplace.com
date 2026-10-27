import assert from "node:assert/strict";
import { GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { InboxAddressSchema, ISSUE_OUTPUT_KEY, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryEmailImportCompletion } from "./in-memory-email-import-completion";
import { initInMemoryInboxEmail } from "./in-memory-inbox-email";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const receivedAtMessageId = "2026-10-27T00:00:00.000Z#<m@example.com>";
const origin = { kind: "history" as const, accountEmail: GmailAccountEmailSchema.parse("a@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1") };
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
	return initInMemoryEmailImportCompletion({ getEmail: emails.getEmail });
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
		const completion = initInMemoryEmailImportCompletion({ getEmail: async () => undefined });
		await completion.acknowledgeOutput({ userId, receivedAtMessageId, output: ISSUE_OUTPUT_KEY });
		assert.equal(await completion.findCompletion({ userId, receivedAtMessageId }), undefined);
		await assert.rejects(completion.addGmailOrigins({ userId, receivedAtMessageId, origins: [origin] }));
		await assert.rejects(completion.selectOutputs({ userId, receivedAtMessageId, selection }));
	});
});
