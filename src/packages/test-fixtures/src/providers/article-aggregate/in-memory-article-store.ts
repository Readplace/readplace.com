import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	AggregateField,
	Article,
	ArticleStore,
} from "@packages/domain/article-aggregate";

interface SavedCall {
	article: Article;
	transitionName: string;
	writes: readonly AggregateField[];
}

/**
 * In-memory ArticleStore for tests. Stores aggregates keyed on the normalized
 * URL (the same key the production DynamoDB store uses) so a `save({url:
 * "https://example.com/a?utm=x"})` followed by `load("https://example.com/a")`
 * reads the same row — mirroring DynamoDB's normalization at the boundary.
 *
 * Records each `save` call on `savedCalls` so tests can assert on the
 * transition name and the `writes` scope the orchestrator threaded through.
 */
export function initInMemoryArticleStore(): ArticleStore & {
	seed: (article: Article) => void;
	savedCalls: readonly SavedCall[];
} {
	const rows = new Map<string, Article>();
	const savedCalls: SavedCall[] = [];

	function key(url: string): string {
		return ArticleResourceUniqueId.parse(url).value;
	}

	const store: ArticleStore = {
		load: async (url) => {
			const stored = rows.get(key(url));
			if (!stored) return undefined;
			return { ...stored, url };
		},
		save: async ({ article, transitionName, writes }) => {
			savedCalls.push({ article, transitionName, writes });
			rows.set(key(article.url), article);
		},
	};

	return {
		...store,
		seed: (article) => {
			rows.set(key(article.url), article);
		},
		savedCalls,
	};
}
