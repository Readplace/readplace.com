import { InboxAddressSchema, MessageIdSchema, type InboxEmailEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initResumeAcceptedGmailEmail } from "./resume-accepted-gmail-email";

it("resumes only an accepted Gmail delivery from the same immutable raw object", async () => {
	const userId = UserIdSchema.parse("reader");
	const address = InboxAddressSchema.parse("work-abc123@read.place");
	const receivedAtMessageId = "2026-10-04T00:00:00.000Z#<issue@sender>";
	let email: InboxEmailEntry | undefined;
	const published: unknown[] = [];
	const resume = initResumeAcceptedGmailEmail({ getEmail: async () => email, publishEvent: async (_event, detail) => { published.push(detail); } });
	const input = { userId, receivedAtMessageId, rawEmailS3Key: "inbound/original", origin: "receive" as const };
	expect(await resume(input)).toBe(false);
	email = { userId, receivedAtMessageId, recipientAddress: address, messageId: MessageIdSchema.parse("<issue@sender>"), senderEmail: "news@sender", subject: "News", status: "unparsed", receivedAt: "2026-10-04T00:00:00.000Z", rawEmailS3Key: input.rawEmailS3Key, bodyS3Key: undefined, linkCounts: undefined };
	expect(await resume(input)).toBe(false);
	email = { ...email, status: "received", bodyS3Key: "content/body" };
	expect(await resume(input)).toBe(false);
	email = { ...email, gmailDestinationAddresses: [address] };
	expect(await resume({ ...input, rawEmailS3Key: "inbound/another-attempt" })).toBe(false);
	expect(published).toEqual([]);
	expect(await resume(input)).toBe(true);
	expect(published).toEqual([{ userId, receivedAtMessageId, recipientAddress: address, origin: "receive", routing: { kind: "gmail", destinationAddresses: [address] } }]);
});
