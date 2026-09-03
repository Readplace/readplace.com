import type { UserId } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetOnboardingSignals,
	MarkFirstInboxEmailNoticeSent,
	NativeAppPlatform,
	RecordDeleteArticleAcknowledged,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordNextReadStepOutstanding,
} from "@packages/provider-contracts/onboarding-signals";

export function initInMemoryOnboardingSignals(deps: { now: () => Date }): {
	recordNativeAppAnyActivity: RecordNativeAppAnyActivity;
	recordNativeAppSavedArticle: RecordNativeAppSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordNextReadStepOutstanding: RecordNextReadStepOutstanding;
	recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged;
	recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged;
	markFirstInboxEmailNoticeSent: MarkFirstInboxEmailNoticeSent;
	getOnboardingSignals: GetOnboardingSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const activated: Record<NativeAppPlatform, Set<UserId>> = {
		ios: new Set(),
		android: new Set(),
	};
	const saved: Record<NativeAppPlatform, Set<UserId>> = {
		ios: new Set(),
		android: new Set(),
	};
	const nextReadMinimumReached = new Map<UserId, Date>();
	const nextReadStepOutstanding = new Map<UserId, Date>();
	const markReadAcrossQueuesAcked = new Map<UserId, Date>();
	const deleteArticleAcked = new Map<UserId, Date>();
	const firstInboxEmailNoticeSent = new Map<UserId, string>();

	const recordNativeAppAnyActivity: RecordNativeAppAnyActivity = async ({ userId, platform }) => {
		activated[platform].add(userId);
	};

	const recordNativeAppSavedArticle: RecordNativeAppSavedArticle = async ({ userId, platform }) => {
		activated[platform].add(userId);
		saved[platform].add(userId);
	};

	const recordNextReadMinimumReached: RecordNextReadMinimumReached = async ({
		userId,
	}) => {
		if (nextReadMinimumReached.has(userId)) return;
		nextReadMinimumReached.set(userId, deps.now());
	};

	const recordNextReadStepOutstanding: RecordNextReadStepOutstanding = async ({
		userId,
	}) => {
		if (nextReadStepOutstanding.has(userId)) return;
		nextReadStepOutstanding.set(userId, deps.now());
	};

	const recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged = async ({
		userId,
	}) => {
		if (markReadAcrossQueuesAcked.has(userId)) return;
		markReadAcrossQueuesAcked.set(userId, deps.now());
	};

	const recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged = async ({ userId }) => {
		if (deleteArticleAcked.has(userId)) return;
		deleteArticleAcked.set(userId, deps.now());
	};

	const markFirstInboxEmailNoticeSent: MarkFirstInboxEmailNoticeSent = async ({
		userId,
		sentAt,
	}) => {
		if (firstInboxEmailNoticeSent.has(userId)) return "already-sent";
		firstInboxEmailNoticeSent.set(userId, sentAt);
		return "claimed";
	};

	const getOnboardingSignals: GetOnboardingSignals = async ({ userId }) => ({
		nativeApp: {
			ios: { installed: activated.ios.has(userId), savedArticle: saved.ios.has(userId) },
			android: {
				installed: activated.android.has(userId),
				savedArticle: saved.android.has(userId),
			},
		},
		nextReadMinimumReachedAt: nextReadMinimumReached.get(userId),
		nextReadStepOutstandingAt: nextReadStepOutstanding.get(userId),
		markReadAcrossQueuesAckedAt: markReadAcrossQueuesAcked.get(userId),
		deleteArticleAckedAt: deleteArticleAcked.get(userId),
	});

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		activated.ios.delete(userId);
		activated.android.delete(userId);
		saved.ios.delete(userId);
		saved.android.delete(userId);
		nextReadMinimumReached.delete(userId);
		nextReadStepOutstanding.delete(userId);
		markReadAcrossQueuesAcked.delete(userId);
		deleteArticleAcked.delete(userId);
		firstInboxEmailNoticeSent.delete(userId);
	};

	return {
		recordNativeAppAnyActivity,
		recordNativeAppSavedArticle,
		recordNextReadMinimumReached,
		recordNextReadStepOutstanding,
		recordMarkReadAcrossQueuesAcknowledged,
		recordDeleteArticleAcknowledged,
		markFirstInboxEmailNoticeSent,
		getOnboardingSignals,
		deleteOnboarding,
	};
}
