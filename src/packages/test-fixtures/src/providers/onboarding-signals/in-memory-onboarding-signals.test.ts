import type { UserId } from "@packages/domain/user";
import { initInMemoryOnboardingSignals } from "./in-memory-onboarding-signals";

const USER = "user-1" as UserId;
const FIRST = new Date("2026-08-16T09:00:00.000Z");
const LATER = new Date("2026-09-01T09:00:00.000Z");

function storeAt(...instants: Date[]) {
	const clock = [...instants];
	const last = instants[instants.length - 1] ?? FIRST;
	return initInMemoryOnboardingSignals({ now: () => clock.shift() ?? last });
}

describe("initInMemoryOnboardingSignals", () => {
	it("reports nothing installed or saved before any activity", async () => {
		const store = storeAt(FIRST);

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			installed: false,
			savedArticle: false,
			nextReadMinimumReachedAt: undefined,
		});
	});

	it("marks installed but not saved when any activity is recorded", async () => {
		const store = storeAt(FIRST);

		await store.recordIosAnyActivity({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			installed: true,
			savedArticle: false,
			nextReadMinimumReachedAt: undefined,
		});
	});

	it("marks both installed and saved when a save is recorded (no prior activation)", async () => {
		const store = storeAt(FIRST);

		await store.recordIosSavedArticle({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			installed: true,
			savedArticle: true,
			nextReadMinimumReachedAt: undefined,
		});
	});

	it("stamps the Next Read minimum with the injected clock", async () => {
		const store = storeAt(FIRST);

		await store.recordNextReadMinimumReached({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			installed: false,
			savedArticle: false,
			nextReadMinimumReachedAt: FIRST,
		});
	});

	it("keeps the first Next Read timestamp when the milestone is recorded again", async () => {
		const store = storeAt(FIRST, LATER);

		await store.recordNextReadMinimumReached({ userId: USER });
		await store.recordNextReadMinimumReached({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.nextReadMinimumReachedAt).toEqual(FIRST);
	});

	it("tracks signals per user independently", async () => {
		const store = storeAt(FIRST);

		await store.recordIosSavedArticle({ userId: USER });
		await store.recordNextReadMinimumReached({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: "user-2" as UserId })).toEqual({
			installed: false,
			savedArticle: false,
			nextReadMinimumReachedAt: undefined,
		});
	});

	it("clears every signal for a user on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		await store.recordIosSavedArticle({ userId: USER });
		await store.recordNextReadMinimumReached({ userId: USER });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			installed: false,
			savedArticle: false,
			nextReadMinimumReachedAt: undefined,
		});
	});

	it("leaves another user's signals intact on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		const other = "user-2" as UserId;
		await store.recordIosSavedArticle({ userId: USER });
		await store.recordIosSavedArticle({ userId: other });
		await store.recordNextReadMinimumReached({ userId: other });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: other })).toEqual({
			installed: true,
			savedArticle: true,
			nextReadMinimumReachedAt: FIRST,
		});
	});
});
