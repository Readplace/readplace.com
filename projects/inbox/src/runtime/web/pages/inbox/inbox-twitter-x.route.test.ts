import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<tweet@x>";
const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
const TWEET_ON_X = "https://x.com/jack/status/20";
const cardPath = `/inbox/${encodeURIComponent(SK)}/links/0000/card`;

function tweetLink(userId: UserId): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: TWEET_ON_TWITTER,
		resolvedUrl: undefined,
		status: "crawled",
		title: "A tweet",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
	};
}

async function cardFor(record: (params: { store: ReturnType<typeof createDefaultTestAppFixture>["inboxEmail"]["inboxSavedLinkStore"]; userId: UserId }) => Promise<void>) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(tweetLink(user.userId));
	await record({ store: fixture.inboxEmail.inboxSavedLinkStore, userId: user.userId });
	const response = await agent.get(cardPath);
	const card = new JSDOM(response.text).window.document.querySelector("[data-test-inbox-article-card]");
	assert(card, "the card must render");
	const save = card.querySelector('[data-test-card-action="save"]');
	assert(save, "the save button must render for a saveable link");
	return save;
}

describe("an emailed twitter.com link's save button", () => {
	it("reads saved once the tweet was saved as its x.com article", async () => {
		const save = await cardFor(({ store, userId }) => store.markLinkSaved({ userId, url: TWEET_ON_X }));

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("stays saved when the emailed twitter.com command dead-letters after the x.com save landed", async () => {
		const save = await cardFor(async ({ store, userId }) => {
			await store.markLinkSaved({ userId, url: TWEET_ON_X });
			await store.markLinkSaveFailed({ userId, url: TWEET_ON_TWITTER });
		});

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("stays saved from a legacy twitter.com save after the new x.com article is deleted", async () => {
		const save = await cardFor(async ({ store, userId }) => {
			await store.markLinkSaved({ userId, url: TWEET_ON_TWITTER });
			await store.markLinkSaved({ userId, url: TWEET_ON_X });
			await store.retractLinkSaved({ userId, url: TWEET_ON_X });
		});

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("returns to unsaved once both articles are deleted", async () => {
		const save = await cardFor(async ({ store, userId }) => {
			await store.markLinkSaved({ userId, url: TWEET_ON_TWITTER });
			await store.markLinkSaved({ userId, url: TWEET_ON_X });
			await store.retractLinkSaved({ userId, url: TWEET_ON_X });
			await store.retractLinkSaved({ userId, url: TWEET_ON_TWITTER });
		});

		expect(save.getAttribute("data-test-save-state")).toBe("unsaved");
	});
});
