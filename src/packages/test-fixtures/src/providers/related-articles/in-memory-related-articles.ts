import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticleByUrl,
} from "@packages/provider-contracts/article-store";
import type {
	FindRelatedArticles,
	MarkRelatedArticlesOutcome,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedArticleDisplay,
	RelatedArticleLink,
} from "@packages/provider-contracts/related-articles";

type SettledRelatedArticles =
	| { status: "skipped" }
	| { status: "ready"; links: readonly RelatedArticleLink[] };

function keyOf(userId: UserId, url: string): string {
	return `${userId}|${ArticleResourceUniqueId.parse(url).value}`;
}

export function initInMemoryRelatedArticles(deps: {
	findArticleByUrl: FindArticleByUrl;
	findArticleById: FindArticleById;
}): {
	findRelatedArticles: FindRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
} {
	const states = new Map<string, SettledRelatedArticles>();

	const findRelatedArticles: FindRelatedArticles = async ({ userId, url }) => {
		const settled = states.get(keyOf(userId, url));
		if (!settled) return { status: "pending" };
		if (settled.status === "skipped") return { status: "skipped" };

		const items: RelatedArticleDisplay[] = [];
		for (const link of settled.links) {
			const article = await deps.findArticleByUrl(link.url);
			if (!article) continue;
			const saved = await deps.findArticleById(article.id, userId);
			if (saved?.status !== "unread") continue;
			items.push({
				id: saved.id,
				title: saved.metadata.title,
				siteName: saved.metadata.siteName,
				reason: link.reason,
				savedAt: saved.savedAt,
			});
		}
		return { status: "ready", items };
	};

	const settle = (
		userId: UserId,
		url: string,
		state: SettledRelatedArticles,
	): MarkRelatedArticlesOutcome => {
		const key = keyOf(userId, url);
		if (states.has(key)) return "superseded";
		states.set(key, state);
		return "stored";
	};

	const markRelatedArticlesReady: MarkRelatedArticlesReady = async ({
		userId,
		url,
		relatedArticles,
	}) => settle(userId, url, { status: "ready", links: relatedArticles });

	const markRelatedArticlesSkipped: MarkRelatedArticlesSkipped = async ({
		userId,
		url,
	}) => settle(userId, url, { status: "skipped" });

	return {
		findRelatedArticles,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
	};
}
