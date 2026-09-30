import assert from "node:assert/strict";
import { ForwardableSenderSchema, GMAIL_HISTORY_IMPORT_PAGE_SIZE, GmailMessageIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailHistory, type InMemoryGmailMessage } from "./in-memory-gmail-history";
import { initInMemoryRawEmailBucket } from "./in-memory-raw-email-bucket";

const READER = UserIdSchema.parse("user-1");
const OTHER_READER = UserIdSchema.parse("user-2");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const WINDOW = { start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" };

function message(overrides: Partial<InMemoryGmailMessage> & { messageId: InMemoryGmailMessage["messageId"] }): InMemoryGmailMessage {
	return {
		userId: READER,
		sender: TLDR,
		raw: Buffer.from(`Message-ID: <${overrides.messageId}@tldr.tech>\r\n\r\nbody`),
		internalDate: "2026-09-15T00:00:00.000Z",
		labelIds: ["INBOX", "UNREAD"],
		...overrides,
	};
}

describe("initInMemoryGmailHistory", () => {
	it("lists only the reader's unread mail from the sender inside the window, newest first", async () => {
		const gmail = initInMemoryGmailHistory();
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("older"), internalDate: "2026-09-02T00:00:00.000Z" }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("newer"), internalDate: "2026-09-20T00:00:00.000Z" }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("read"), labelIds: ["INBOX"] }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("spam"), labelIds: ["SPAM", "UNREAD"] }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("trash"), labelIds: ["TRASH", "UNREAD"] }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("beforeWindow"), internalDate: "2026-08-31T23:59:59.000Z" }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("windowEnd"), internalDate: WINDOW.end }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("otherSender"), sender: BREW }));
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("otherReader"), userId: OTHER_READER }));

		const listed = await gmail.history.listUnreadMessageIds({ userId: READER, sender: TLDR, window: WINDOW, pageToken: undefined });

		assert.deepEqual(listed, { ok: true, value: { messageIds: ["newer", "older"], nextPageToken: undefined } });
		assert.deepEqual(gmail.listRequests, [{ sender: TLDR, window: WINDOW, pageToken: undefined }]);
	});

	it("pages through a long listing with the page token", async () => {
		const gmail = initInMemoryGmailHistory();
		for (let index = 0; index <= GMAIL_HISTORY_IMPORT_PAGE_SIZE; index++) {
			gmail.addMessage(
				message({
					messageId: GmailMessageIdSchema.parse(`m${String(index).padStart(2, "0")}`),
					internalDate: `2026-09-15T00:00:${String(index).padStart(2, "0")}.000Z`,
				}),
			);
		}

		const first = await gmail.history.listUnreadMessageIds({ userId: READER, sender: TLDR, window: WINDOW, pageToken: undefined });
		assert(first.ok);
		assert.equal(first.value.messageIds.length, GMAIL_HISTORY_IMPORT_PAGE_SIZE);
		assert.equal(first.value.messageIds[0], "m25");

		const second = await gmail.history.listUnreadMessageIds({
			userId: READER,
			sender: TLDR,
			window: WINDOW,
			pageToken: first.value.nextPageToken,
		});
		assert.deepEqual(second, { ok: true, value: { messageIds: ["m00"], nextPageToken: undefined } });
	});

	it("fetches the raw bytes, date and labels of the reader's message", async () => {
		const gmail = initInMemoryGmailHistory();
		const stored = message({ messageId: GmailMessageIdSchema.parse("abc") });
		gmail.addMessage(stored);

		const fetched = await gmail.history.fetchRawMessage({ userId: READER, messageId: stored.messageId });

		assert.deepEqual(fetched, { ok: true, value: { raw: stored.raw, internalDate: stored.internalDate, labelIds: stored.labelIds } });
	});

	it("answers not found for a deleted message or another reader's message", async () => {
		const gmail = initInMemoryGmailHistory();
		gmail.addMessage(message({ messageId: GmailMessageIdSchema.parse("theirs"), userId: OTHER_READER }));

		assert.deepEqual(await gmail.history.fetchRawMessage({ userId: READER, messageId: GmailMessageIdSchema.parse("gone") }), {
			ok: true,
			value: { notFound: true },
		});
		assert.deepEqual(await gmail.history.fetchRawMessage({ userId: READER, messageId: GmailMessageIdSchema.parse("theirs") }), {
			ok: true,
			value: { notFound: true },
		});
	});

	it("returns each queued failure once, per method", async () => {
		const gmail = initInMemoryGmailHistory();
		const stored = message({ messageId: GmailMessageIdSchema.parse("abc") });
		gmail.addMessage(stored);
		gmail.failNext({ method: "listUnreadMessageIds", failure: { ok: false, reason: "readonly-permission-required" } });
		gmail.failNext({ method: "fetchRawMessage", failure: { ok: false, reason: "unavailable", status: 503 } });

		const listing = { userId: READER, sender: TLDR, window: WINDOW, pageToken: undefined };
		assert.deepEqual(await gmail.history.listUnreadMessageIds(listing), { ok: false, reason: "readonly-permission-required" });
		assert.deepEqual(await gmail.history.listUnreadMessageIds(listing), { ok: true, value: { messageIds: ["abc"], nextPageToken: undefined } });
		assert.deepEqual(await gmail.history.fetchRawMessage({ userId: READER, messageId: stored.messageId }), {
			ok: false,
			reason: "unavailable",
			status: 503,
		});
		assert.equal((await gmail.history.fetchRawMessage({ userId: READER, messageId: stored.messageId })).ok, true);
	});
});

describe("initInMemoryRawEmailBucket", () => {
	it("stores raw mail by key, overwriting a re-fetch with the same key", async () => {
		const bucket = initInMemoryRawEmailBucket();

		await bucket.put({ key: "gmail-import/u/j/a.eml", raw: Buffer.from("first") });
		await bucket.put({ key: "gmail-import/u/j/a.eml", raw: Buffer.from("again") });

		assert.deepEqual(bucket.keys(), ["gmail-import/u/j/a.eml"]);
		assert.equal((await bucket.read("gmail-import/u/j/a.eml"))?.toString(), "again");
		assert.equal(await bucket.read("gmail-import/u/j/missing.eml"), undefined);
	});
});
