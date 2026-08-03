import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryInboxSavedLink } from "./in-memory-inbox-saved-link";

const userId = UserIdSchema.parse("user-1");
const otherUserId = UserIdSchema.parse("user-2");

describe("initInMemoryInboxSavedLink", () => {
	it("finds a save made under a differently-tracked url", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post?utm_source=news" });

		const states = await store.findSavedLinks({ userId, urls: ["https://example.com/post"] });

		expect(states.get("https://example.com/post")).toBe("saved");
	});

	it("leaves a url with no row out of the result", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({
			userId,
			urls: ["https://example.com/post", "https://example.com/other"],
		});

		expect([...states.keys()]).toEqual(["https://example.com/post"]);
	});

	it("scopes state to the user who saved it", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({
			userId: otherUserId,
			urls: ["https://example.com/post"],
		});

		expect(states.size).toBe(0);
	});

	it("keeps an accepted save when a dead-lettered command reports failure afterwards", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });
		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({ userId, urls: ["https://example.com/post"] });

		expect(states.get("https://example.com/post")).toBe("saved");
	});

	it("lets a later success replace a recorded failure", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({ userId, urls: ["https://example.com/post"] });

		expect(states.get("https://example.com/post")).toBe("saved");
	});

	it("reports a failed save as its own state", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({ userId, urls: ["https://example.com/post"] });

		expect(states.get("https://example.com/post")).toBe("failed");
	});

	it("finds a save whose url is far longer than a DynamoDB sort key allows", async () => {
		const store = initInMemoryInboxSavedLink();
		const longUrl = `https://esp.example.com/click/${"a".repeat(2000)}`;
		await store.markLinkSaved({ userId, url: longUrl });

		const states = await store.findSavedLinks({ userId, urls: [longUrl] });

		expect(states.get(longUrl)).toBe("saved");
	});

	it("skips a url that is not parseable", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const states = await store.findSavedLinks({
			userId,
			urls: ["mailto:someone@example.com but not a url", "https://example.com/post"],
		});

		expect([...states.keys()]).toEqual(["https://example.com/post"]);
	});

	it("leaves no state behind when a save is retracted", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		await store.retractLinkSaved({ userId, url: "https://example.com/post" });

		expect((await store.findSavedLinks({ userId, urls: ["https://example.com/post"] })).size).toBe(0);
	});

	it("retracts a recorded failure too, since the row is gone either way", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });

		await store.retractLinkSaved({ userId, url: "https://example.com/post" });

		expect((await store.findSavedLinks({ userId, urls: ["https://example.com/post"] })).size).toBe(0);
	});

	it("retracts a url that was never recorded without disturbing another", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		await store.retractLinkSaved({ userId, url: "https://example.com/other" });

		expect(
			(await store.findSavedLinks({ userId, urls: ["https://example.com/post"] })).get(
				"https://example.com/post",
			),
		).toBe("saved");
	});

	it("scopes a retraction to the user who asked for it", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });
		await store.markLinkSaved({ userId: otherUserId, url: "https://example.com/post" });

		await store.retractLinkSaved({ userId, url: "https://example.com/post" });

		expect(
			(await store.findSavedLinks({ userId: otherUserId, urls: ["https://example.com/post"] })).get(
				"https://example.com/post",
			),
		).toBe("saved");
	});

	it("drops only the named user's rows on delete", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: "https://example.com/post" });
		await store.markLinkSaved({ userId: otherUserId, url: "https://example.com/post" });

		await store.deleteAllByUserId(userId);

		expect((await store.findSavedLinks({ userId, urls: ["https://example.com/post"] })).size).toBe(0);
		expect(
			(await store.findSavedLinks({ userId: otherUserId, urls: ["https://example.com/post"] })).get(
				"https://example.com/post",
			),
		).toBe("saved");
	});
});
