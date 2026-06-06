import type { UserId } from "@packages/domain/user";
import { initInMemoryNewsletterInbox } from "./in-memory-newsletter-inbox";

const USER = "user-1" as UserId;

describe("initInMemoryNewsletterInbox", () => {
	it("creates a token on first request and returns the same token thereafter", async () => {
		const store = initInMemoryNewsletterInbox();

		const first = await store.getOrCreateInbox(USER);
		const second = await store.getOrCreateInbox(USER);

		expect(first.token).toMatch(/^[0-9a-f]{24}$/);
		expect(second.token).toBe(first.token);
	});

	it("resolves a userId from a known token and undefined for an unknown one", async () => {
		const store = initInMemoryNewsletterInbox();
		const { token } = await store.getOrCreateInbox(USER);

		expect(await store.findUserIdByInboxToken(token)).toBe(USER);
		const unknown = "ffffffffffffffffffffffff" as Awaited<
			ReturnType<typeof store.getOrCreateInbox>
		>["token"];
		expect(await store.findUserIdByInboxToken(unknown)).toBeUndefined();
	});
});
