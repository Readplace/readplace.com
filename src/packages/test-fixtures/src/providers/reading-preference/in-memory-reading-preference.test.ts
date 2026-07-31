import type { UserId } from "@packages/domain/user";
import { initInMemoryReadingPreference } from "./in-memory-reading-preference";

const USER = "user-1" as UserId;

describe("initInMemoryReadingPreference", () => {
	it("reports no preference before the user has saved one", async () => {
		const store = initInMemoryReadingPreference();

		expect(await store.getReadingPreference({ userId: USER })).toBeUndefined();
	});

	it("returns the saved text", async () => {
		const store = initInMemoryReadingPreference();

		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		expect(await store.getReadingPreference({ userId: USER })).toEqual({
			text: "Essays on systems design",
		});
	});

	it("replaces the text when the user re-saves", async () => {
		const store = initInMemoryReadingPreference();
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		await store.saveReadingPreference({ userId: USER, text: "Trip reports from long hikes" });

		expect(await store.getReadingPreference({ userId: USER })).toEqual({
			text: "Trip reports from long hikes",
		});
	});

	it("tracks preferences per user independently", async () => {
		const store = initInMemoryReadingPreference();

		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		expect(await store.getReadingPreference({ userId: "user-2" as UserId })).toBeUndefined();
	});

	it("clears the preference for a user on deleteReadingPreference", async () => {
		const store = initInMemoryReadingPreference();
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });

		await store.deleteReadingPreference({ userId: USER });

		expect(await store.getReadingPreference({ userId: USER })).toBeUndefined();
	});

	it("leaves another user's preference intact on deleteReadingPreference", async () => {
		const store = initInMemoryReadingPreference();
		const other = "user-2" as UserId;
		await store.saveReadingPreference({ userId: USER, text: "Essays on systems design" });
		await store.saveReadingPreference({ userId: other, text: "Trip reports from long hikes" });

		await store.deleteReadingPreference({ userId: USER });

		expect(await store.getReadingPreference({ userId: other })).toEqual({
			text: "Trip reports from long hikes",
		});
	});
});
