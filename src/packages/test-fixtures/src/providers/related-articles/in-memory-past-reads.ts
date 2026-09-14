import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticleByUrl,
} from "@packages/provider-contracts/article-store";
import type {
	FindPastReads,
	MarkPastReadsReady,
	PastReadDisplay,
	PastReadLink,
} from "@packages/provider-contracts/related-articles";

function keyOf(userId: UserId, url: string): string {
	return `${userId}|${ArticleResourceUniqueId.parse(url).value}`;
}

/** In-memory past-reads store for dev and route tests. `findPastReads` reports
 * pending until a computation is settled with `markPastReadsReady`, mirroring how
 * the real store reads a row that no worker has written yet. */
export function initInMemoryPastReads(deps: {
	findArticleByUrl: FindArticleByUrl;
	findArticleById: FindArticleById;
}): {
	findPastReads: FindPastReads;
	markPastReadsReady: MarkPastReadsReady;
} {
	const settled = new Map<string, readonly PastReadLink[]>();

	const findPastReads: FindPastReads = async ({ userId, url }) => {
		const links = settled.get(keyOf(userId, url));
		if (links === undefined) return { status: "pending" };

		const items: PastReadDisplay[] = [];
		for (const link of links) {
			const article = await deps.findArticleByUrl(link.url);
			if (!article) continue;
			const saved = await deps.findArticleById(article.id, userId);
			if (saved?.status !== "read") continue;
			items.push({
				id: saved.id,
				title: saved.metadata.title,
				siteName: saved.metadata.siteName,
				reason: link.reason,
				...(link.readlist !== undefined ? { readlist: link.readlist } : {}),
			});
		}
		return { status: "ready", items };
	};

	const markPastReadsReady: MarkPastReadsReady = async ({ userId, url, pastReads }) => {
		settled.set(keyOf(userId, url), pastReads);
		return "stored";
	};

	return { findPastReads, markPastReadsReady };
}
