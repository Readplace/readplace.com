import type { UserId } from "@packages/domain/user";

/** First 6 chars of the sharer's userId, stamped into `utm_content` on
 * share redirects so the receiving page can recognise that the visitor
 * arrived via a logged-in user's share link and treat the link as
 * permanent (no expiry) rather than applying the standard public
 * 3-day window. */
export function shareUserIdPrefix(userId: UserId): string {
	return userId.slice(0, 6);
}
