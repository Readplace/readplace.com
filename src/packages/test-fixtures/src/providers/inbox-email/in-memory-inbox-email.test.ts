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
		linkCounts: undefined,
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
			cursor: undefined,
			pageSize: 20,
		});

		expect(ownerEmails.emails.map((e) => e.subject)).toEqual(["Newer", "Older"]);
		expect(ownerEmails).toMatchObject({ hasNewer: false, hasOlder: false });
	});

	it("walks older pages from a cursor and back newer to the top", async () => {
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
			cursor: undefined,
			pageSize: 2,
		});
		expect(pageOne.emails.map((e) => e.subject)).toEqual(["At 10", "At 09"]);
		expect(pageOne).toMatchObject({ hasNewer: false, hasOlder: true });

		const older = await store.listEmailsByUserId({
			userId: owner,
			cursor: {
				direction: "older",
				receivedAtMessageId: pageOne.emails[1].receivedAtMessageId,
			},
			pageSize: 2,
		});
		expect(older.emails.map((e) => e.subject)).toEqual(["At 08"]);
		expect(older).toMatchObject({ hasNewer: true, hasOlder: false });

		const newer = await store.listEmailsByUserId({
			userId: owner,
			cursor: {
				direction: "newer",
				receivedAtMessageId: older.emails[0].receivedAtMessageId,
			},
			pageSize: 2,
		});
		expect(newer.emails.map((e) => e.subject)).toEqual(["At 10", "At 09"]);
		expect(newer).toMatchObject({ hasNewer: false, hasOlder: true });
	});

	it("takes the newer rows adjacent to the cursor when more than a page exist", async () => {
		const store = initInMemoryInboxEmail();
		for (const hour of ["07", "08", "09", "10"]) {
			await store.putEmail(
				makeEntry({
					messageId: MessageIdSchema.parse(`<m-${hour}@x>`),
					receivedAtMessageId: `2026-06-23T${hour}:00:00.000Z#<m-${hour}@x>`,
					subject: `At ${hour}`,
				}),
			);
		}

		const result = await store.listEmailsByUserId({
			userId: owner,
			cursor: {
				direction: "newer",
				receivedAtMessageId: "2026-06-23T07:00:00.000Z#<m-07@x>",
			},
			pageSize: 1,
		});

		expect(result.emails.map((e) => e.subject)).toEqual(["At 08"]);
		expect(result).toMatchObject({ hasNewer: true, hasOlder: true });
	});

	it("returns an empty page past the oldest email", async () => {
		const store = initInMemoryInboxEmail();
		const entry = makeEntry();
		await store.putEmail(entry);

		const result = await store.listEmailsByUserId({
			userId: owner,
			cursor: {
				direction: "older",
				receivedAtMessageId: entry.receivedAtMessageId,
			},
			pageSize: 2,
		});

		expect(result.emails).toEqual([]);
		expect(result).toMatchObject({ hasNewer: true, hasOlder: false });
	});

	it("rejects a cursor with an empty boundary row", async () => {
		const store = initInMemoryInboxEmail();

		await expect(
			store.listEmailsByUserId({
				userId: owner,
				cursor: { direction: "older", receivedAtMessageId: "" },
				pageSize: 2,
			}),
		).rejects.toThrow("cursor must name a boundary row");
	});

	it("returns undefined for an unknown email", async () => {
		const store = initInMemoryInboxEmail();

		expect(
			await store.getEmail({ userId: owner, receivedAtMessageId: "missing" }),
		).toBeUndefined();
	});

	describe("setEmailLinkCounts", () => {
		it("stamps counts readable on the stored row", async () => {
			const store = initInMemoryInboxEmail();
			const entry = makeEntry();
			await store.putEmail(entry);

			await store.setEmailLinkCounts({
				userId: owner,
				receivedAtMessageId: entry.receivedAtMessageId,
				linkCounts: { kept: 2, skipped: 1, truncated: false },
			});

			const found = await store.getEmail({
				userId: owner,
				receivedAtMessageId: entry.receivedAtMessageId,
			});
			assert(found, "expected the stored email to resolve");
			expect(found.linkCounts).toEqual({ kept: 2, skipped: 1, truncated: false });
		});

		it("keeps the counts when the email row is redelivered as a duplicate", async () => {
			const store = initInMemoryInboxEmail();
			const entry = makeEntry();
			await store.putEmail(entry);
			await store.setEmailLinkCounts({
				userId: owner,
				receivedAtMessageId: entry.receivedAtMessageId,
				linkCounts: { kept: 1, skipped: 0, truncated: false },
			});

			expect(await store.putEmail(entry)).toBe("duplicate");

			const found = await store.getEmail({
				userId: owner,
				receivedAtMessageId: entry.receivedAtMessageId,
			});
			assert(found, "expected the stored email to resolve");
			expect(found.linkCounts).toEqual({ kept: 1, skipped: 0, truncated: false });
		});

		it("rejects counts for a missing email row", async () => {
			const store = initInMemoryInboxEmail();

			await expect(
				store.setEmailLinkCounts({
					userId: owner,
					receivedAtMessageId: "missing",
					linkCounts: { kept: 0, skipped: 0, truncated: false },
				}),
			).rejects.toThrow("setEmailLinkCounts requires an existing email row");
		});
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
				cursor: undefined,
				pageSize: 20,
			});
			expect(remaining.emails).toHaveLength(2);
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
				cursor: undefined,
				pageSize: 20,
			});
			expect(remaining.emails).toHaveLength(0);
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
				cursor: undefined,
				pageSize: 20,
			});
			const otherRemaining = await store.listEmailsByUserId({
				userId: otherUser,
				cursor: undefined,
				pageSize: 20,
			});
			expect(ownerRemaining.emails).toHaveLength(0);
			expect(otherRemaining.emails).toHaveLength(1);
		});

		it("is a no-op for a user with no emails", async () => {
			const store = initInMemoryInboxEmail();

			await store.deleteAllEmailsByUserId(owner);

			const remaining = await store.listEmailsByUserId({
				userId: owner,
				cursor: undefined,
				pageSize: 20,
			});
			expect(remaining.emails).toHaveLength(0);
		});
	});
});
