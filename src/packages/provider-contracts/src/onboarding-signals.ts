import type { UserId } from "@packages/domain/user";

/** The native apps whose install/save progress is tracked per user. Each gets its
 * own pair of timestamps: ticking the Android install step off an iPhone save
 * would credit a device the user does not have. */
export type NativeAppPlatform = "ios" | "android";

/** Records that a native app made an authenticated request for this user, marking
 * that app "installed" (set-once). Idempotent — repeated calls never overwrite
 * the first timestamp, so it is safe to call on every authenticated app request. */
export type RecordNativeAppAnyActivity = (params: {
	userId: UserId;
	platform: NativeAppPlatform;
}) => Promise<void>;

/** Records that the user saved their first article from a native app, marking the
 * save (set-once). A save also implies that app is installed and signed in, so
 * this marks "installed" too — a share sheet can save without ever loading the
 * queue, so the saved signal must not depend on a prior activity write.
 * Idempotent — repeated calls never overwrite the first timestamps. */
export type RecordNativeAppSavedArticle = (params: {
	userId: UserId;
	platform: NativeAppPlatform;
}) => Promise<void>;

/** Records that the account's save count reached the Next Read minimum
 * (set-once). Named for the count that was observed, not for a promise about
 * Next Read: the compute-side gate gets fewer candidates than the raw count, so
 * reaching the minimum makes Next Read possible, never certain.
 * Idempotent — repeated calls never overwrite the first timestamp. */
export type RecordNextReadMinimumReached = (params: {
	userId: UserId;
}) => Promise<void>;

export type RecordInboxArticleQueued = (params: {
	userId: UserId;
}) => Promise<void>;

export type RecordEmailStepMarkedDone = (params: {
	userId: UserId;
}) => Promise<void>;

export type RecordOnboardingOutstandingVersion = (params: {
	userId: UserId;
	version: string;
}) => Promise<void>;

/** Records that the reader acknowledged that marking an article read or unread
 * applies to every queue that article is on (set-once). Its presence suppresses
 * the confirmation panel from then on, on every surface.
 * Idempotent — repeated calls never overwrite the first timestamp. */
export type RecordMarkReadAcrossQueuesAcknowledged = (params: {
	userId: UserId;
}) => Promise<void>;

/** Records that the reader acknowledged what deleting an article costs them
 * (set-once). Its presence suppresses the confirmation panel from then on, so
 * the card's Delete button deletes on the first press.
 * Idempotent — repeated calls never overwrite the first timestamp. */
export type RecordDeleteArticleAcknowledged = (params: {
	userId: UserId;
}) => Promise<void>;

/** Reads the per-user onboarding signals the `/queue` render ticks steps from.
 * Per app, `installed` is true once that app has made any authenticated request
 * and `savedArticle` once a save has come from it — both read by the phone's
 * browser, which can't see the app's cookies. `nextReadMinimumReachedAt` is
 * account-scoped rather than device-scoped, and its presence is the milestone. */
export type GetOnboardingSignals = (params: {
	userId: UserId;
}) => Promise<{
	nativeApp: Record<NativeAppPlatform, { installed: boolean; savedArticle: boolean }>;
	nextReadMinimumReachedAt: Date | undefined;
	firstInboxArticleQueuedAt: Date | undefined;
	emailStepMarkedDoneAt: Date | undefined;
	onboardingOutstandingVersion: string | undefined;
	markReadAcrossQueuesAckedAt: Date | undefined;
	deleteArticleAckedAt: Date | undefined;
}>;

export type MarkFirstInboxEmailNoticeSent = (input: {
	userId: UserId;
	sentAt: string;
}) => Promise<"claimed" | "already-sent">;

/** Delete the single onboarding row for a user (account deletion). */
export type DeleteOnboarding = (params: { userId: UserId }) => Promise<void>;
