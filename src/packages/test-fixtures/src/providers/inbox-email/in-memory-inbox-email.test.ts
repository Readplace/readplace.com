import assert from "node:assert/strict";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryInboxEmail } from "./in-memory-inbox-email";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");

function makeEntry(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: owner,
		receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
		messageId: MessageIdSchema.parse("<m-1@example.com>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-23T00:00:00.000Z",
		rawEmailS3Key: "inbound/m-1",
		bodyS3Key: "content/m-1/content.html",
		...overrides,
	};
}

describe("initInMemoryInboxEmail", () => {
	it("stores then gets an email by its composite key", async () => {
		const store = initInMemoryInboxEmail();
		const entry = makeEntry();

		expect(await store.putEmail(entry)).toBe("stored");
		const found = await store.getEmail({
			userId: owner,
			receivedAtMessageId: entry.receivedAtMessageId,
		});

		assert(found, "expected the stored email to resolve");
		expect(found.subject).toBe("Weekly digest");
	});

	it("reports a redelivery of the same sort key as a duplicate without overwriting", async () => {
		const store = initInMemoryInboxEmail();
		const entry = makeEntry();

		await store.putEmail(entry);
		expect(await store.putEmail({ ...entry, subject: "Tampered" })).toBe("duplicate");

		const found = await store.getEmail({
			userId: owner,
			receivedAtMessageId: entry.receivedAtMessageId,
		});
		assert(found);
		expect(found.subject).toBe("Weekly digest");
	});

	it("lists only the owner's emails, newest first", async () => {
		const store = initInMemoryInboxEmail();
		await store.putEmail(
			makeEntry({
				messageId: MessageIdSchema.parse("<older@x>"),
				receivedAtMessageId: "2026-06-23T08:00:00.000Z#<older@x>",
				subject: "Older",
			}),
		);
		await store.putEmail(
			makeEntry({
				messageId: MessageIdSchema.parse("<newer@x>"),
				receivedAtMessageId: "2026-06-23T09:00:00.000Z#<newer@x>",
				subject: "Newer",
			}),
		);
		await store.putEmail(
			makeEntry({
				userId: otherUser,
				messageId: MessageIdSchema.parse("<other@x>"),
				receivedAtMessageId: "2026-06-23T10:00:00.000Z#<other@x>",
				subject: "Other user",
			}),
		);

		const ownerEmails = await store.listEmailsByUserId(owner);

		expect(ownerEmails.map((e) => e.subject)).toEqual(["Newer", "Older"]);
	});

	it("returns undefined for an unknown email", async () => {
		const store = initInMemoryInboxEmail();

		expect(
			await store.getEmail({ userId: owner, receivedAtMessageId: "missing" }),
		).toBeUndefined();
	});
});
