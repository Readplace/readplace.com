import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "@packages/domain/user";
import type {
	FindRelatedArticles,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedArticleDisplay,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";

export type InMemorySeedRelatedArticles = (params: {
	userId: UserId;
	url: string;
	items: readonly RelatedArticleDisplay[];
}) => Promise<void>;

function keyOf(userId: UserId, url: string): string {
	return `${userId}|${ArticleResourceUniqueId.parse(url).value}`;
}

export function initInMemoryRelatedArticles(): {
	findRelatedArticles: FindRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
	seedRelatedArticles: InMemorySeedRelatedArticles;
} {
	const states = new Map<string, RelatedArticles>();

	const findRelatedArticles: FindRelatedArticles = async ({ userId, url }) =>
		states.get(keyOf(userId, url)) ?? { status: "pending" };

	const markRelatedArticlesReady: MarkRelatedArticlesReady = async ({
		userId,
		url,
	}) => {
		states.set(keyOf(userId, url), { status: "ready", items: [] });
	};

	const markRelatedArticlesSkipped: MarkRelatedArticlesSkipped = async ({
		userId,
		url,
	}) => {
		states.set(keyOf(userId, url), { status: "skipped" });
	};

	const seedRelatedArticles: InMemorySeedRelatedArticles = async ({
		userId,
		url,
		items,
	}) => {
		states.set(keyOf(userId, url), { status: "ready", items });
	};

	return {
		findRelatedArticles,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
		seedRelatedArticles,
	};
}
