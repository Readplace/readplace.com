import {
	NewsletterMessageIdSchema,
	type NewsletterMessage,
} from "@packages/domain/newsletter";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { initInMemoryNewsletterMessages } from "./in-memory-newsletter-messages";

const USER = "user-1" as UserId;
const OTHER = "user-2" as UserId;

function message(opts: {
	id: string;
	receivedAt: string;
	userId?: UserId;
	subject?: string;
	savedLinks?: NewsletterMessage["savedLinks"];
}): NewsletterMessage {
	return {
		id: NewsletterMessageIdSchema.parse(opts.id),
		userId: opts.userId ?? USER,
		subject: opts.subject ?? "Subject",
		fromAddress: "news@example.com",
		receivedAt: opts.receivedAt,
		html: "<p>Body</p>",
		savedLinks: opts.savedLinks ?? [
			{ url: "https://example.com/a", articleId: ReaderArticleHashIdSchema.parse("a".repeat(32)) },
		],
		skippedCount: 0,
	};
}

describe("initInMemoryNewsletterMessages", () => {
	it("records messages and lists them newest-first with a saved-link count", async () => {
		const store = initInMemoryNewsletterMessages();
		await store.recordMessage(message({ id: "older", receivedAt: "2026-06-01T00:00:00.000Z" }));
		await store.recordMessage(message({ id: "newer", receivedAt: "2026-06-05T00:00:00.000Z" }));

		const list = await store.listMessages(USER);

		expect(list.map((m) => m.id)).toEqual(["newer", "older"]);
		expect(list[0].savedCount).toBe(1);
	});

	it("returns an empty list for a user with no messages", async () => {
		const store = initInMemoryNewsletterMessages();
		expect(await store.listMessages(OTHER)).toEqual([]);
	});

	it("finds a message by id, scoped to the owner", async () => {
		const store = initInMemoryNewsletterMessages();
		await store.recordMessage(message({ id: "msg-1", receivedAt: "2026-06-05T00:00:00.000Z" }));

		const found = await store.findMessage({ userId: USER, id: NewsletterMessageIdSchema.parse("msg-1") });
		expect(found?.subject).toBe("Subject");

		const missing = await store.findMessage({ userId: USER, id: NewsletterMessageIdSchema.parse("nope") });
		expect(missing).toBeUndefined();
		const wrongOwner = await store.findMessage({ userId: OTHER, id: NewsletterMessageIdSchema.parse("msg-1") });
		expect(wrongOwner).toBeUndefined();
	});
});
