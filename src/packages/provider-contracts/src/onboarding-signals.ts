import type { UserId } from "@packages/domain/user";

/** Records that the iOS app made an authenticated request for this user, marking
 * the user "installed" (set-once). Idempotent — repeated calls never overwrite
 * the first timestamp, so it is safe to call on every authenticated app request. */
export type RecordIosAnyActivity = (params: {
	userId: UserId;
}) => Promise<void>;

/** Records that the user saved their first article from the iOS app, marking the
 * save (set-once). A save also implies the app is installed and signed in, so
 * this marks "installed" too — the share extension can save without ever loading
 * the queue, so the saved signal must not depend on a prior activity write.
 * Idempotent — repeated calls never overwrite the first timestamps. */
export type RecordIosSavedArticle = (params: {
	userId: UserId;
}) => Promise<void>;

/** Records that the account's save count reached the Next Read minimum
 * (set-once). Named for the count that was observed, not for a promise about
 * Next Read: the compute-side gate gets fewer candidates than the raw count, so
 * reaching the minimum makes Next Read possible, never certain.
 * Idempotent — repeated calls never overwrite the first timestamp. */
export type RecordNextReadMinimumReached = (params: {
	userId: UserId;
}) => Promise<void>;

/** Records that the reader was shown the Next Read step with saves still to go
 * (set-once). Its absence beside a reached milestone is what tells the render
 * the step was satisfied by a queue the reader already had, so nothing was
 * accomplished and there is nothing to congratulate.
 * Idempotent — repeated calls never overwrite the first timestamp. */
export type RecordNextReadStepOutstanding = (params: {
	userId: UserId;
}) => Promise<void>;

/** Reads the per-user onboarding signals the `/queue` render ticks steps from.
 * `installed` is true once the iOS app has made any authenticated request and
 * `savedArticle` once a save has come from the app — both read by Safari, which
 * can't see the app's cookies. `nextReadMinimumReachedAt` is account-scoped
 * rather than device-scoped, and its presence is the milestone;
 * `nextReadStepOutstandingAt` says the reader once had saves to go, so the pair
 * separates a milestone earned from one granted to an already-deep queue. */
export type GetOnboardingSignals = (params: {
	userId: UserId;
}) => Promise<{
	installed: boolean;
	savedArticle: boolean;
	nextReadMinimumReachedAt: Date | undefined;
	nextReadStepOutstandingAt: Date | undefined;
}>;

/** Delete the single onboarding row for a user (account deletion). */
export type DeleteOnboarding = (params: { userId: UserId }) => Promise<void>;
