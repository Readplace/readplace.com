import type { ArticleStatus } from "@packages/domain/article";

/**
 * The internal-click `utm_content` element each card mode stamps on its link and
 * its dismiss form. The dashboard reads these to tell an unread suggestion apart
 * from the past-read fallback, so both sides must name the same strings. The
 * unread values are the ones the card shipped with, kept so the existing click
 * history stays continuous.
 */
export const NEXT_READ_TRACKING = {
	unread: {
		clickContent: "related",
		dismissContent: "next-read-dismiss",
	},
	read: {
		clickContent: "related-past",
		dismissContent: "next-read-past-dismiss",
	},
} as const satisfies Record<
	ArticleStatus,
	{ clickContent: string; dismissContent: string }
>;
