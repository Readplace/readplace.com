import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryInboxSavedLink } from "./in-memory-inbox-saved-link";
import { initInMemoryMarkLinkSavedWhileQueued } from "./in-memory-mark-link-saved-while-queued";

const userId = UserIdSchema.parse("user-1");
const url = "https://example.com/post";
const queueRowKey = { userId: "user-1", url: "example.com/post" };

describe("initInMemoryMarkLinkSavedWhileQueued", () => {
	it("records the link saved while the queue row exists", async () => {
		const inboxSavedLinkStore = initInMemoryInboxSavedLink();
		const mark = initInMemoryMarkLinkSavedWhileQueued({ hasQueueRow: () => true, inboxSavedLinkStore });

		await mark({ userId, url, queueRowKey });

		const states = await inboxSavedLinkStore.findSavedLinks({ userId, urls: [url] });
		expect(states.get(url)).toBe("saved");
	});

	it("rejects and records nothing once the queue row is gone", async () => {
		const inboxSavedLinkStore = initInMemoryInboxSavedLink();
		const mark = initInMemoryMarkLinkSavedWhileQueued({ hasQueueRow: () => false, inboxSavedLinkStore });

		await expect(mark({ userId, url, queueRowKey })).rejects.toThrow("ConditionalCheckFailed");

		const states = await inboxSavedLinkStore.findSavedLinks({ userId, urls: [url] });
		expect(states.has(url)).toBe(false);
	});
});
