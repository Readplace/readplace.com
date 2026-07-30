import type { UserId } from "@packages/domain/user";
import { initInMemoryReadingPreference } from "./in-memory-reading-preference";

const USER = "user-1" as UserId;
const SAVED_AT = new Date("2026-07-27T10:00:00.000Z");

describe("initInMemoryReadingPreference", () => {
	it("reports no preference before the user has saved one", async () => {
		const store = initInMemoryReadingPreference({ now: () => SAVED_AT });

		expect(await store.getReadingPreference({ userId: USER })).toBeUndefined();
	});

	it("returns the saved text stamped with the save instant", async () => {
		const store = initInMemoryReadingPreference({ now: () => SAVED_AT });

		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		expect(await store.getReadingPreference({ userId: USER })).toEqual({
			text: "Essays on systems design",
			updatedAt: SAVED_AT.toISOString(),
		});
	});

	it("replaces both the text and the timestamp when the user re-saves", async () => {
		let now = SAVED_AT;
		const store = initInMemoryReadingPreference({ now: () => now });
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		now = new Date("2026-07-28T09:00:00.000Z");
		await store.saveReadingPreference({ userId: USER, text: "Trip reports from long hikes" });

		expect(await store.getReadingPreference({ userId: USER })).toEqual({
			text: "Trip reports from long hikes",
			updatedAt: "2026-07-28T09:00:00.000Z",
		});
	});

	it("tracks preferences per user independently", async () => {
		const store = initInMemoryReadingPreference({ now: () => SAVED_AT });

		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		expect(await store.getReadingPreference({ userId: "user-2" as UserId })).toBeUndefined();
	});

	it("clears the preference for a user on deleteReadingPreference", async () => {
		const store = initInMemoryReadingPreference({ now: () => SAVED_AT });
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		await store.deleteReadingPreference({ userId: USER });

		expect(await store.getReadingPreference({ userId: USER })).toBeUndefined();
	});

	it("leaves another user's preference intact on deleteReadingPreference", async () => {
		const store = initInMemoryReadingPreference({ now: () => SAVED_AT });
		const other = "user-2" as UserId;
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });
		await store.saveReadingPreference({ userId: other, text: "Trip reports from long hikes" });

		await store.deleteReadingPreference({ userId: USER });

		expect(await store.getReadingPreference({ userId: other })).toEqual({
			text: "Trip reports from long hikes",
			updatedAt: SAVED_AT.toISOString(),
		});
	});
});
