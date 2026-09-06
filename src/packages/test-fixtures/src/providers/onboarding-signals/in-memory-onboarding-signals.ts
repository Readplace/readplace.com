import type { UserId } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetOnboardingSignals,
	MarkFirstInboxEmailNoticeSent,
	NativeAppPlatform,
	RecordDeleteArticleAcknowledged,
	RecordEmailStepMarkedDone,
	RecordInboxArticleQueued,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordOnboardingOutstandingVersion,
} from "@packages/provider-contracts/onboarding-signals";

export function initInMemoryOnboardingSignals(deps: { now: () => Date }): {
	recordNativeAppAnyActivity: RecordNativeAppAnyActivity;
	recordNativeAppSavedArticle: RecordNativeAppSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordInboxArticleQueued: RecordInboxArticleQueued;
	recordEmailStepMarkedDone: RecordEmailStepMarkedDone;
	recordOnboardingOutstandingVersion: RecordOnboardingOutstandingVersion;
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
	const firstInboxArticleQueued = new Map<UserId, Date>();
	const emailStepMarkedDone = new Map<UserId, Date>();
	const onboardingOutstandingVersion = new Map<UserId, string>();
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

	const recordInboxArticleQueued: RecordInboxArticleQueued = async ({ userId }) => {
		if (firstInboxArticleQueued.has(userId)) return;
		firstInboxArticleQueued.set(userId, deps.now());
	};

	const recordEmailStepMarkedDone: RecordEmailStepMarkedDone = async ({ userId }) => {
		if (emailStepMarkedDone.has(userId)) return;
		emailStepMarkedDone.set(userId, deps.now());
	};

	const recordOnboardingOutstandingVersion: RecordOnboardingOutstandingVersion = async ({
		userId,
		version,
	}) => {
		onboardingOutstandingVersion.set(userId, version);
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
		firstInboxArticleQueuedAt: firstInboxArticleQueued.get(userId),
		emailStepMarkedDoneAt: emailStepMarkedDone.get(userId),
		onboardingOutstandingVersion: onboardingOutstandingVersion.get(userId),
		markReadAcrossQueuesAckedAt: markReadAcrossQueuesAcked.get(userId),
		deleteArticleAckedAt: deleteArticleAcked.get(userId),
	});

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		activated.ios.delete(userId);
		activated.android.delete(userId);
		saved.ios.delete(userId);
		saved.android.delete(userId);
		nextReadMinimumReached.delete(userId);
		firstInboxArticleQueued.delete(userId);
		emailStepMarkedDone.delete(userId);
		onboardingOutstandingVersion.delete(userId);
		markReadAcrossQueuesAcked.delete(userId);
		deleteArticleAcked.delete(userId);
		firstInboxEmailNoticeSent.delete(userId);
	};

	return {
		recordNativeAppAnyActivity,
		recordNativeAppSavedArticle,
		recordNextReadMinimumReached,
		recordInboxArticleQueued,
		recordEmailStepMarkedDone,
		recordOnboardingOutstandingVersion,
		recordMarkReadAcrossQueuesAcknowledged,
		recordDeleteArticleAcknowledged,
		markFirstInboxEmailNoticeSent,
		getOnboardingSignals,
		deleteOnboarding,
	};
}
