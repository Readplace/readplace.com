import type { ArticleStatus, SavedArticle } from "./article.types";
import type { ReaderArticleHashId } from "./reader-article-hash-id";

export const NEXT_READ_SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface NextReadDismissal {
	at: Date;
	suggestionId: ReaderArticleHashId | undefined;
}

export type NextReadSlot = "suppress" | "show";

const HOLD_MS = {
	read: Number.POSITIVE_INFINITY,
	unread: NEXT_READ_SNOOZE_MS,
} satisfies Record<ArticleStatus, number>;

export function nextReadDismissalOf(
	article: SavedArticle,
): NextReadDismissal | undefined {
	const at = article.relatedDismissedAt;
	if (at === undefined) return undefined;
	return { at, suggestionId: article.relatedDismissedSuggestionId };
}

export function decideNextReadSlot(input: {
	dismissal: NextReadDismissal | undefined;
	related: readonly { id: ReaderArticleHashId; status: ArticleStatus }[];
	now: Date;
}): NextReadSlot {
	const dismissal = input.dismissal;
	if (dismissal === undefined) return "show";
	const suggestionId = dismissal.suggestionId;
	if (suggestionId === undefined) return "suppress";
	const dismissed = input.related.find(
		(item) => item.id.value === suggestionId.value,
	);
	if (dismissed === undefined) return "show";
	return input.now.getTime() - dismissal.at.getTime() < HOLD_MS[dismissed.status]
		? "suppress"
		: "show";
}
