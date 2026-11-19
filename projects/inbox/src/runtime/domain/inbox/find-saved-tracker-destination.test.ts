import { MinutesSchema } from "@packages/domain/article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFindSavedTrackerDestination } from "./find-saved-tracker-destination";
import { saveTrackerThroughUnlocker } from "./save-tracker-through-unlocker";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const BEEHIIV_TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.token-for-the-post/4ab/h1/sig";
const DESTINATION = "https://example.com/post";

describe("findSavedTrackerDestination", () => {
	it("returns the destination a save of the tracker resolved", async () => {
		const store = initInMemoryArticleStore();
		await saveTrackerThroughUnlocker({ store, tracker: BEEHIIV_TRACKER, destination: DESTINATION });
		const findSavedTrackerDestination = initFindSavedTrackerDestination({ findIdentityRow: store.findIdentityRow });

		expect(await findSavedTrackerDestination(BEEHIIV_TRACKER)).toBe(DESTINATION);
	});

	it("drops the utm_* parameters the destination carries, as a finished card does", async () => {
		const store = initInMemoryArticleStore();
		await saveTrackerThroughUnlocker({
			store,
			tracker: BEEHIIV_TRACKER,
			destination: `${DESTINATION}?ref=feed&utm_source=newsletter&utm_medium=email`,
		});
		const findSavedTrackerDestination = initFindSavedTrackerDestination({ findIdentityRow: store.findIdentityRow });

		expect(await findSavedTrackerDestination(BEEHIIV_TRACKER)).toBe(`${DESTINATION}?ref=feed`);
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
