import type { UserId } from "@packages/domain/user";

/** Records that the iOS app made an authenticated request for this user. Always
 * marks the user "installed" (set-once); when `savedArticle` is true, also marks
 * the first save (set-once). Idempotent — repeated calls never overwrite the
 * first timestamp, so it is safe to call on every authenticated app request. */
export type RecordIosAppActivity = (params: {
	userId: UserId;
	savedArticle: boolean;
}) => Promise<void>;

/** Reads the per-user iOS onboarding signals so Safari's `/queue` render can
 * tick the iPhone-app steps. `installed` is true once the app has made any
 * authenticated request; `savedArticle` once a save has come from the app. */
export type GetIosAppSignals = (params: {
	userId: UserId;
}) => Promise<{ installed: boolean; savedArticle: boolean }>;
