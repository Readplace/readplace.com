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

describe("initInMemoryInboxSavedLink — a tweet linked on twitter.com and x.com", () => {
	const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
	const TWEET_ON_X = "https://x.com/jack/status/20";

	it("reads a twitter.com link as saved once its x.com article was saved, keyed by the link the caller asked about", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: TWEET_ON_X });

		const states = await store.findSavedLinks({ userId, urls: [TWEET_ON_TWITTER, TWEET_ON_X] });

		expect([...states.entries()]).toEqual([
			[TWEET_ON_TWITTER, "saved"],
			[TWEET_ON_X, "saved"],
		]);
	});

	it("reads an x.com link as saved from a legacy twitter.com save", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: TWEET_ON_TWITTER });

		const states = await store.findSavedLinks({ userId, urls: [TWEET_ON_X] });

		expect(states.get(TWEET_ON_X)).toBe("saved");
	});

	it("lets a save under either host outrank a failure recorded later under the other", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: TWEET_ON_X });
		await store.markLinkSaveFailed({ userId, url: TWEET_ON_TWITTER });

		const states = await store.findSavedLinks({ userId, urls: [TWEET_ON_TWITTER] });

		expect(states.get(TWEET_ON_TWITTER)).toBe("saved");
	});

	it("reads a failure recorded under the other host as failed", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaveFailed({ userId, url: TWEET_ON_X });

		const states = await store.findSavedLinks({ userId, urls: [TWEET_ON_TWITTER] });

		expect(states.get(TWEET_ON_TWITTER)).toBe("failed");
	});

	it("retracts only the host it is told to, leaving the other save standing", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: TWEET_ON_TWITTER });
		await store.markLinkSaved({ userId, url: TWEET_ON_X });

		await store.retractLinkSaved({ userId, url: TWEET_ON_X });

		expect((await store.findSavedLinks({ userId, urls: [TWEET_ON_X] })).get(TWEET_ON_X)).toBe("saved");
		await store.retractLinkSaved({ userId, url: TWEET_ON_TWITTER });
		expect((await store.findSavedLinks({ userId, urls: [TWEET_ON_X] })).size).toBe(0);
	});

	it("keeps a twitter.com subdomain apart", async () => {
		const store = initInMemoryInboxSavedLink();
		await store.markLinkSaved({ userId, url: TWEET_ON_X });

		const states = await store.findSavedLinks({ userId, urls: ["https://mobile.twitter.com/jack/status/20"] });

		expect(states.size).toBe(0);
	});
});
