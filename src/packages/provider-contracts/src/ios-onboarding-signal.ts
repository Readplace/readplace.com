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

/** Reads the per-user iOS onboarding signals so Safari's `/queue` render can
 * tick the iPhone-app steps. `installed` is true once the app has made any
 * authenticated request; `savedArticle` once a save has come from the app. */
export type GetIosAppSignals = (params: {
	userId: UserId;
}) => Promise<{ installed: boolean; savedArticle: boolean }>;
