import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<amazon@x>";
const TITLE = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
const BARE = "https://www.amazon.com.au/dp/1492043451";
const cardPath = `/inbox/${encodeURIComponent(SK)}/links/0000/card`;

function productLink(params: { userId: UserId; url: string }): InboxEmailLinkEntry {
	return {
		userId: params.userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: params.url,
		resolvedUrl: undefined,
		status: "crawled",
		title: "A book",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		anchorText: undefined,
	};
}

async function cardFor(params: {
	cardUrl: string;
	record: (params: { store: ReturnType<typeof createDefaultTestAppFixture>["inboxEmail"]["inboxSavedLinkStore"]; userId: UserId }) => Promise<void>;
}) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(productLink({ userId: user.userId, url: params.cardUrl }));
	await params.record({ store: fixture.inboxEmail.inboxSavedLinkStore, userId: user.userId });
	const response = await agent.get(cardPath);
	const card = new JSDOM(response.text).window.document.querySelector("[data-test-inbox-article-card]");
	assert(card, "the card must render");
	const save = card.querySelector('[data-test-card-action="save"]');
	assert(save, "the save button must render for a saveable link");
	return save;
}

describe("an emailed Amazon product link's save button", () => {
	it("reads saved once the product was saved as its bare article", async () => {
		const save = await cardFor({ cardUrl: TITLE, record: ({ store, userId }) => store.markLinkSaved({ userId, url: BARE }) });

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("stays saved when the emailed title-link command dead-letters after the bare save landed", async () => {
		const save = await cardFor({
			cardUrl: TITLE,
			record: async ({ store, userId }) => {
				await store.markLinkSaved({ userId, url: BARE });
				await store.markLinkSaveFailed({ userId, url: TITLE });
			},
		});

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("stays saved from a legacy title-link save after the new bare article is deleted", async () => {
		const save = await cardFor({
			cardUrl: TITLE,
			record: async ({ store, userId }) => {
				await store.markLinkSaved({ userId, url: TITLE });
				await store.markLinkSaved({ userId, url: BARE });
				await store.retractLinkSaved({ userId, url: BARE });
			},
		});

		expect(save.getAttribute("data-test-save-state")).toBe("saved");
	});

	it("returns to unsaved once both articles are deleted", async () => {
		const save = await cardFor({
			cardUrl: TITLE,
			record: async ({ store, userId }) => {
				await store.markLinkSaved({ userId, url: TITLE });
				await store.markLinkSaved({ userId, url: BARE });
				await store.retractLinkSaved({ userId, url: BARE });
				await store.retractLinkSaved({ userId, url: TITLE });
			},
		});

		expect(save.getAttribute("data-test-save-state")).toBe("unsaved");
	});

	it("does not read a bare-link card as saved from a legacy title-link save", async () => {
		const save = await cardFor({ cardUrl: BARE, record: ({ store, userId }) => store.markLinkSaved({ userId, url: TITLE }) });

		expect(save.getAttribute("data-test-save-state")).toBe("unsaved");
	});
});
