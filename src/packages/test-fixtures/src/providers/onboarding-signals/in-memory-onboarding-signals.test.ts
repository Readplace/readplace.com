import type { UserId } from "@packages/domain/user";
import { initInMemoryOnboardingSignals } from "./in-memory-onboarding-signals";

const USER = "user-1" as UserId;
const FIRST = new Date("2026-08-16T09:00:00.000Z");
const LATER = new Date("2026-09-01T09:00:00.000Z");

const NOTHING_RECORDED = {
	nativeApp: {
		ios: { installed: false, savedArticle: false },
		android: { installed: false, savedArticle: false },
	},
	nextReadMinimumReachedAt: undefined,
	firstInboxArticleQueuedAt: undefined,
	emailStepMarkedDoneAt: undefined,
	onboardingOutstandingVersion: undefined,
	markReadAcrossQueuesAckedAt: undefined,
};

function storeAt(...instants: Date[]) {
	const clock = [...instants];
	const last = instants[instants.length - 1] ?? FIRST;
	return initInMemoryOnboardingSignals({ now: () => clock.shift() ?? last });
}

describe("initInMemoryOnboardingSignals", () => {
	it("reports nothing installed or saved before any activity", async () => {
		const store = storeAt(FIRST);

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual(NOTHING_RECORDED);
	});

	it("marks installed but not saved when any activity is recorded", async () => {
		const store = storeAt(FIRST);

		await store.recordNativeAppAnyActivity({ userId: USER, platform: "ios" });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			...NOTHING_RECORDED,
			nativeApp: {
				ios: { installed: true, savedArticle: false },
				android: { installed: false, savedArticle: false },
			},
		});
	});

	it("marks both installed and saved when a save is recorded (no prior activation)", async () => {
		const store = storeAt(FIRST);

		await store.recordNativeAppSavedArticle({ userId: USER, platform: "ios" });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			...NOTHING_RECORDED,
			nativeApp: {
				ios: { installed: true, savedArticle: true },
				android: { installed: false, savedArticle: false },
			},
		});
	});

	it("keeps each app's signals to itself, so one phone never ticks the other's steps", async () => {
		const store = storeAt(FIRST);

		await store.recordNativeAppSavedArticle({ userId: USER, platform: "android" });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			...NOTHING_RECORDED,
			nativeApp: {
				ios: { installed: false, savedArticle: false },
				android: { installed: true, savedArticle: true },
			},
		});
	});

	it("stamps the Next Read minimum with the injected clock", async () => {
		const store = storeAt(FIRST);

		await store.recordNextReadMinimumReached({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual({
			...NOTHING_RECORDED,
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

	it("stamps the first inbox article set-once with the injected clock", async () => {
		const store = storeAt(FIRST, LATER);

		await store.recordInboxArticleQueued({ userId: USER });
		await store.recordInboxArticleQueued({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.firstInboxArticleQueuedAt).toEqual(FIRST);
	});

	it("stamps the email step marked-done set-once with the injected clock", async () => {
		const store = storeAt(FIRST, LATER);

		await store.recordEmailStepMarkedDone({ userId: USER });
		await store.recordEmailStepMarkedDone({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.emailStepMarkedDoneAt).toEqual(FIRST);
	});

	it("keeps the newest outstanding version, overwriting the previous one", async () => {
		const store = storeAt(FIRST);

		await store.recordOnboardingOutstandingVersion({ userId: USER, version: "aaaa1111" });
		await store.recordOnboardingOutstandingVersion({ userId: USER, version: "bbbb2222" });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.onboardingOutstandingVersion).toBe("bbbb2222");
	});

	it("stamps the mark-read acknowledgement set-once with the injected clock", async () => {
		const store = storeAt(FIRST, LATER);

		await store.recordMarkReadAcrossQueuesAcknowledged({ userId: USER });
		await store.recordMarkReadAcrossQueuesAcknowledged({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.markReadAcrossQueuesAckedAt).toEqual(FIRST);
	});

	it("clears the mark-read acknowledgement on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		await store.recordMarkReadAcrossQueuesAcknowledged({ userId: USER });

		await store.deleteOnboarding({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.markReadAcrossQueuesAckedAt).toBeUndefined();
	});

	it("stamps the delete acknowledgement set-once with the injected clock", async () => {
		const store = storeAt(FIRST, LATER);

		await store.recordDeleteArticleAcknowledged({ userId: USER });
		await store.recordDeleteArticleAcknowledged({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.deleteArticleAckedAt).toEqual(FIRST);
	});

	it("clears the delete acknowledgement on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		await store.recordDeleteArticleAcknowledged({ userId: USER });

		await store.deleteOnboarding({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.deleteArticleAckedAt).toBeUndefined();
	});

	it("clears the inbox, marked-done and version stamps on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		await store.recordInboxArticleQueued({ userId: USER });
		await store.recordEmailStepMarkedDone({ userId: USER });
		await store.recordOnboardingOutstandingVersion({ userId: USER, version: "aaaa1111" });

		await store.deleteOnboarding({ userId: USER });

		const signals = await store.getOnboardingSignals({ userId: USER });
		expect(signals.firstInboxArticleQueuedAt).toBeUndefined();
		expect(signals.emailStepMarkedDoneAt).toBeUndefined();
		expect(signals.onboardingOutstandingVersion).toBeUndefined();
	});

	it("claims the first-inbox-email marker once, then reports already-sent", async () => {
		const store = storeAt(FIRST);

		const first = await store.markFirstInboxEmailNoticeSent({
			userId: USER,
			sentAt: FIRST.toISOString(),
		});
		const second = await store.markFirstInboxEmailNoticeSent({
			userId: USER,
			sentAt: LATER.toISOString(),
		});

		expect(first).toBe("claimed");
		expect(second).toBe("already-sent");
	});

	it("lets the marker be claimed again after deleteOnboarding clears it", async () => {
		const store = storeAt(FIRST);
		await store.markFirstInboxEmailNoticeSent({ userId: USER, sentAt: FIRST.toISOString() });

		await store.deleteOnboarding({ userId: USER });

		expect(
			await store.markFirstInboxEmailNoticeSent({ userId: USER, sentAt: LATER.toISOString() }),
		).toBe("claimed");
	});

	it("tracks signals per user independently", async () => {
		const store = storeAt(FIRST);

		await store.recordNativeAppSavedArticle({ userId: USER, platform: "ios" });
		await store.recordNextReadMinimumReached({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: "user-2" as UserId })).toEqual(
			NOTHING_RECORDED,
		);
	});

	it("clears every signal for a user on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		await store.recordNativeAppSavedArticle({ userId: USER, platform: "ios" });
		await store.recordNativeAppSavedArticle({ userId: USER, platform: "android" });
		await store.recordNextReadMinimumReached({ userId: USER });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: USER })).toEqual(NOTHING_RECORDED);
	});

	it("leaves another user's signals intact on deleteOnboarding", async () => {
		const store = storeAt(FIRST);
		const other = "user-2" as UserId;
		await store.recordNativeAppSavedArticle({ userId: USER, platform: "ios" });
		await store.recordNativeAppSavedArticle({ userId: other, platform: "ios" });
		await store.recordNextReadMinimumReached({ userId: other });

		await store.deleteOnboarding({ userId: USER });

		expect(await store.getOnboardingSignals({ userId: other })).toEqual({
			...NOTHING_RECORDED,
			nativeApp: {
				ios: { installed: true, savedArticle: true },
				android: { installed: false, savedArticle: false },
			},
			nextReadMinimumReachedAt: FIRST,
		});
	});
});
