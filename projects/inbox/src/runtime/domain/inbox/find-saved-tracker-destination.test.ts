import assert from "node:assert/strict";
import { MinutesSchema, validateSaveableUrl } from "@packages/domain/article";
import { initResolveSaveIdentity } from "@packages/save-article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFindSavedTrackerDestination } from "./find-saved-tracker-destination";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const BEEHIIV_TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.token-for-the-post/4ab/h1/sig";
const DESTINATION = "https://example.com/post";

async function saveThroughUnlocker(store: ReturnType<typeof initInMemoryArticleStore>) {
	const save = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: store.findIdentityRow,
		claimAlias: store.claimAlias,
		resolveWrapperTarget: async (url) =>
			url === BEEHIIV_TRACKER ? { url: DESTINATION, contentSourceUrl: BEEHIIV_TRACKER } : undefined,
		now: () => NOW,
	});
	const identity = await save(BEEHIIV_TRACKER);
	assert.equal(identity.status, "resolved", "the save must resolve the tracker");
}

describe("findSavedTrackerDestination", () => {
	it("returns the destination a save of the tracker resolved", async () => {
		const store = initInMemoryArticleStore();
		await saveThroughUnlocker(store);
		const findSavedTrackerDestination = initFindSavedTrackerDestination({ findIdentityRow: store.findIdentityRow });

		expect(await findSavedTrackerDestination(BEEHIIV_TRACKER)).toBe(DESTINATION);
	});

	it("returns undefined for a tracker no save has resolved", async () => {
		const store = initInMemoryArticleStore();
		const findSavedTrackerDestination = initFindSavedTrackerDestination({ findIdentityRow: store.findIdentityRow });

		expect(await findSavedTrackerDestination(BEEHIIV_TRACKER)).toBeUndefined();
	});

	it("returns undefined for a tracker saved as its own article", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticleGlobally({
			url: BEEHIIV_TRACKER,
			metadata: { title: "T", siteName: "beehiiv.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(0),
			savedAt: NOW,
		});
		const findSavedTrackerDestination = initFindSavedTrackerDestination({ findIdentityRow: store.findIdentityRow });

		expect(await findSavedTrackerDestination(BEEHIIV_TRACKER)).toBeUndefined();
	});
});
