import type { UserId } from "@packages/domain/user";
import { initInMemoryIosOnboardingSignal } from "./in-memory-ios-onboarding-signal";

const USER = "user-1" as UserId;

describe("initInMemoryIosOnboardingSignal", () => {
	it("reports nothing installed or saved before any activity", async () => {
		const store = initInMemoryIosOnboardingSignal();

		expect(await store.getIosAppSignals({ userId: USER })).toEqual({
			installed: false,
			savedArticle: false,
		});
	});

	it("marks installed but not saved when any activity is recorded", async () => {
		const store = initInMemoryIosOnboardingSignal();

		await store.recordIosAnyActivity({ userId: USER });

		expect(await store.getIosAppSignals({ userId: USER })).toEqual({
			installed: true,
			savedArticle: false,
		});
	});

	it("marks both installed and saved when a save is recorded (no prior activation)", async () => {
		const store = initInMemoryIosOnboardingSignal();

		await store.recordIosSavedArticle({ userId: USER });

		expect(await store.getIosAppSignals({ userId: USER })).toEqual({
			installed: true,
			savedArticle: true,
		});
	});

	it("tracks signals per user independently", async () => {
		const store = initInMemoryIosOnboardingSignal();

		await store.recordIosSavedArticle({ userId: USER });

		expect(await store.getIosAppSignals({ userId: "user-2" as UserId })).toEqual({
			installed: false,
			savedArticle: false,
		});
	});

	it("clears both the installed and saved signals for a user on deleteOnboarding", async () => {
		const store = initInMemoryIosOnboardingSignal();
		await store.recordIosSavedArticle({ userId: USER });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getIosAppSignals({ userId: USER })).toEqual({
			installed: false,
			savedArticle: false,
		});
	});

	it("leaves another user's signals intact on deleteOnboarding", async () => {
		const store = initInMemoryIosOnboardingSignal();
		const other = "user-2" as UserId;
		await store.recordIosSavedArticle({ userId: USER });
		await store.recordIosSavedArticle({ userId: other });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getIosAppSignals({ userId: other })).toEqual({
			installed: true,
			savedArticle: true,
		});
	});
});
