import { ForwardableSenderSchema, GmailAccountEmailSchema, type GmailMessageOrigin, GmailMessageIdSchema } from "@packages/domain/gmail";
import { InboxAddressSchema, MessageIdSchema, type InboxEmailEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initResumeAcceptedGmailEmail } from "./resume-accepted-gmail-email";

it("resumes only an accepted Gmail delivery from the same immutable raw object", async () => {
	const userId = UserIdSchema.parse("reader");
	const address = InboxAddressSchema.parse("work-abc123@read.place");
	const receivedAtMessageId = "2026-10-04T00:00:00.000Z#<issue@sender>";
	let email: InboxEmailEntry | undefined;
	const published: unknown[] = [];
	const added: unknown[] = [];
	const resume = initResumeAcceptedGmailEmail({ getEmail: async () => email, addGmailOrigins: async (input) => { added.push(input); }, publishEvent: async (_event, detail) => { published.push(detail); } });
	const input = { userId, receivedAtMessageId, rawEmailS3Key: "inbound/original", origin: "receive" as const, gmailOrigin: undefined };
	expect(await resume(input)).toBe(false);
	email = { userId, receivedAtMessageId, recipientAddress: address, messageId: MessageIdSchema.parse("<issue@sender>"), senderEmail: "news@sender", subject: "News", status: "unparsed", receivedAt: "2026-10-04T00:00:00.000Z", rawEmailS3Key: input.rawEmailS3Key, bodyS3Key: undefined, linkCounts: undefined };
	expect(await resume(input)).toBe(false);
	email = { ...email, status: "received", bodyS3Key: "content/body" };
	expect(await resume(input)).toBe(false);
	email = { ...email, gmailDestinationAddresses: [address] };
	expect(await resume({ ...input, rawEmailS3Key: "inbound/another-attempt" })).toBe(false);
	expect(published).toEqual([]);
	expect(await resume(input)).toBe(true);
	expect(published).toEqual([{ userId, receivedAtMessageId, recipientAddress: address, origin: "receive", routing: { kind: "gmail", destinationAddresses: [address], deliveryMode: "links" } }]);
	expect(added).toEqual([{ userId, receivedAtMessageId, origins: [] }]);
});

it("resumes a Gmail delivery with the delivery mode it was accepted with", async () => {
	const userId = UserIdSchema.parse("reader");
	const address = InboxAddressSchema.parse("work-abc123@read.place");
	const receivedAtMessageId = "2026-10-04T00:00:00.000Z#<issue@sender>";
	const published: unknown[] = [];
	const email: InboxEmailEntry = {
		userId,
		receivedAtMessageId,
		recipientAddress: address,
		gmailDestinationAddresses: [address],
		gmailDeliveryMode: "issue",
		messageId: MessageIdSchema.parse("<issue@sender>"),
		senderEmail: "news@sender",
		subject: "News",
		status: "received",
		receivedAt: "2026-10-04T00:00:00.000Z",
		rawEmailS3Key: "inbound/original",
		bodyS3Key: "content/body",
		linkCounts: undefined,
	};
	const added: unknown[] = [];
	const resume = initResumeAcceptedGmailEmail({ getEmail: async () => email, addGmailOrigins: async (input) => { added.push(input); }, publishEvent: async (_event, detail) => { published.push(detail); } });
	const gmailOrigin: GmailMessageOrigin = { kind: "history", accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };

	expect(await resume({ userId, receivedAtMessageId, rawEmailS3Key: "inbound/original", origin: "receive", gmailOrigin })).toBe(true);
	expect(added).toEqual([{ userId, receivedAtMessageId, origins: [gmailOrigin] }]);
	expect(published).toEqual([{ userId, receivedAtMessageId, recipientAddress: address, origin: "receive", routing: { kind: "gmail", destinationAddresses: [address], deliveryMode: "issue" } }]);
});
