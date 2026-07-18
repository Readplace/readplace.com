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

		const ownerEmails = await store.listEmailsByUserId({
			userId: owner,
			page: 1,
			pageSize: 20,
		});

		expect(ownerEmails.emails.map((e) => e.subject)).toEqual(["Newer", "Older"]);
		expect(ownerEmails.total).toBe(2);
	});

	it("slices pages newest-first while reporting the unpaged total", async () => {
		const store = initInMemoryInboxEmail();
		for (const hour of ["08", "09", "10"]) {
			await store.putEmail(
				makeEntry({
					messageId: MessageIdSchema.parse(`<m-${hour}@x>`),
					receivedAtMessageId: `2026-06-23T${hour}:00:00.000Z#<m-${hour}@x>`,
					subject: `At ${hour}`,
				}),
			);
		}

		const pageOne = await store.listEmailsByUserId({
			userId: owner,
			page: 1,
			pageSize: 2,
		});
		const pageTwo = await store.listEmailsByUserId({
			userId: owner,
			page: 2,
			pageSize: 2,
		});

		expect(pageOne.emails.map((e) => e.subject)).toEqual(["At 10", "At 09"]);
		expect(pageOne).toMatchObject({ total: 3, page: 1, pageSize: 2 });
		expect(pageTwo.emails.map((e) => e.subject)).toEqual(["At 08"]);
		expect(pageTwo).toMatchObject({ total: 3, page: 2, pageSize: 2 });
	});

	it("returns no emails but the correct total for a page beyond the data", async () => {
		const store = initInMemoryInboxEmail();
		await store.putEmail(makeEntry());

		const result = await store.listEmailsByUserId({
			userId: owner,
			page: 3,
			pageSize: 2,
		});

		expect(result.emails).toEqual([]);
		expect(result.total).toBe(1);
	});

	it("returns undefined for an unknown email", async () => {
		const store = initInMemoryInboxEmail();

		expect(
			await store.getEmail({ userId: owner, receivedAtMessageId: "missing" }),
		).toBeUndefined();
	});

	describe("listDeletionReferencesByUserId", () => {
		it("returns the owner's raw and body S3 keys and message ids without deleting", async () => {
			const store = initInMemoryInboxEmail();
			await store.putEmail(
				makeEntry({
					receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>",
					rawEmailS3Key: "inbound/a",
					bodyS3Key: "content/a/content.html",
				}),
			);
			await store.putEmail(
				makeEntry({
					receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>",
					status: "rejected",
					rawEmailS3Key: "inbound/b",
					bodyS3Key: undefined,
				}),
			);

			const refs = await store.listDeletionReferencesByUserId(owner);

			expect(refs.receivedAtMessageIds).toEqual([
				"2026-06-23T09:00:00.000Z#<a@x>",
				"2026-06-23T08:00:00.000Z#<b@x>",
			]);
			expect(refs.rawEmailS3Keys).toEqual(["inbound/a", "inbound/b"]);
			expect(refs.bodyS3Keys).toEqual(["content/a/content.html"]);
			// The read pass leaves every row in place so a redrive re-derives the keys.
			const remaining = await store.listEmailsByUserId({
				userId: owner,
				page: 1,
				pageSize: 20,
			});
			expect(remaining.total).toBe(2);
		});

		it("scopes the references to the owner, ignoring another user's emails", async () => {
			const store = initInMemoryInboxEmail();
			await store.putEmail(makeEntry({ rawEmailS3Key: "inbound/owner" }));
			await store.putEmail(
				makeEntry({
					userId: otherUser,
					receivedAtMessageId: "2026-06-23T10:00:00.000Z#<other@x>",
					rawEmailS3Key: "inbound/other",
				}),
			);

			const refs = await store.listDeletionReferencesByUserId(owner);

			expect(refs.rawEmailS3Keys).toEqual(["inbound/owner"]);
		});

		it("returns empty lists for a user with no emails", async () => {
			const store = initInMemoryInboxEmail();

			expect(await store.listDeletionReferencesByUserId(owner)).toEqual({
				receivedAtMessageIds: [],
				rawEmailS3Keys: [],
				bodyS3Keys: [],
				emailImageS3KeyPrefixes: [],
			});
		});
	});

	describe("deleteAllEmailsByUserId", () => {
		it("deletes every email the owner owns", async () => {
			const store = initInMemoryInboxEmail();
			await store.putEmail(
				makeEntry({ receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>" }),
			);
			await store.putEmail(
				makeEntry({ receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>" }),
			);

			await store.deleteAllEmailsByUserId(owner);

			const remaining = await store.listEmailsByUserId({
				userId: owner,
				page: 1,
				pageSize: 20,
			});
			expect(remaining.total).toBe(0);
		});

		it("leaves another user's emails intact", async () => {
			const store = initInMemoryInboxEmail();
			await store.putEmail(makeEntry());
			await store.putEmail(
				makeEntry({
					userId: otherUser,
					receivedAtMessageId: "2026-06-23T10:00:00.000Z#<other@x>",
				}),
			);

			await store.deleteAllEmailsByUserId(owner);

			const ownerRemaining = await store.listEmailsByUserId({
				userId: owner,
				page: 1,
				pageSize: 20,
			});
			const otherRemaining = await store.listEmailsByUserId({
				userId: otherUser,
				page: 1,
				pageSize: 20,
			});
			expect(ownerRemaining.total).toBe(0);
			expect(otherRemaining.total).toBe(1);
		});

		it("is a no-op for a user with no emails", async () => {
			const store = initInMemoryInboxEmail();

			await store.deleteAllEmailsByUserId(owner);

			const remaining = await store.listEmailsByUserId({
				userId: owner,
				page: 1,
				pageSize: 20,
			});
			expect(remaining.total).toBe(0);
		});
	});
});
