import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type ComparableArticle, isNonArticleHost, isSameArticle, mayReadItem, viewerFor } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticleByUrl,
	FindItemOwner,
} from "@packages/provider-contracts/article-store";
import type {
	FindPastReads,
	MarkPastReadsBudgetBlocked,
	MarkPastReadsReady,
	PastReadDisplay,
	PastReadLink,
	ReadPastReadsState,
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
	findItemOwner: FindItemOwner;
}): {
	findPastReads: FindPastReads;
	markPastReadsReady: MarkPastReadsReady;
	markPastReadsBudgetBlocked: MarkPastReadsBudgetBlocked;
	readPastReadsState: ReadPastReadsState;
	forgetRow: (params: { userId: UserId; url: string }) => void;
} {
	const settled = new Map<string, readonly PastReadLink[]>();
	const computations = new Map<string, { fingerprint: string; computedAt: Date }>();
	const blocked = new Map<string, Date>();

	const findPastReads: FindPastReads = async ({ userId, url }) => {
		const links = settled.get(keyOf(userId, url));
		const blockedUntil = blocked.get(keyOf(userId, url));
		if (links === undefined) {
			return blockedUntil === undefined ? { status: "pending" } : { status: "budget-limited", until: blockedUntil };
		}

		const kept: ComparableArticle[] = [];
		const items: PastReadDisplay[] = [];
		for (const link of links) {
			const article = await deps.findArticleByUrl(link.url);
			if (!article) continue;
			if (isNonArticleHost(article.url)) continue;
			if (!mayReadItem({ url: article.url, viewer: viewerFor(userId), ownerUserId: await deps.findItemOwner(article.url) })) continue;
			const saved = await deps.findArticleById(article.id, userId);
			if (saved?.status !== "read") continue;
			const comparable = { url: article.url, displayUrl: article.destinationUrl, title: article.metadata.title };
			if (kept.some((earlier) => isSameArticle({ article: comparable, other: earlier }))) continue;
			kept.push(comparable);
			items.push({
				id: saved.id,
				title: saved.metadata.title,
				siteName: saved.metadata.siteName,
				reason: link.reason,
				...(saved.readAt !== undefined ? { readAt: saved.readAt } : {}),
				...(link.readlist !== undefined ? { readlist: link.readlist } : {}),
			});
		}
		return {
			status: "ready",
			items,
			...(blockedUntil !== undefined ? { budgetBlockedUntil: blockedUntil } : {}),
		};
	};

	const markPastReadsReady: MarkPastReadsReady = async ({ userId, url, pastReads, fingerprint, at }) => {
		settled.set(keyOf(userId, url), pastReads);
		computations.set(keyOf(userId, url), { fingerprint, computedAt: at });
		return "stored";
	};

	async function findSave(params: { userId: UserId; url: string }) {
		const article = await deps.findArticleByUrl(params.url);
		return article && (await deps.findArticleById(article.id, params.userId));
	}

	const markPastReadsBudgetBlocked: MarkPastReadsBudgetBlocked = async ({ userId, url, blockedUntil, observed }) => {
		const saved = await findSave({ userId, url });
		if (!saved || observed.savedAt.getTime() !== saved.savedAt.getTime()) return "superseded";
		const storedAt = computations.get(keyOf(userId, url))?.computedAt;
		if (storedAt?.getTime() !== observed.computedAt?.getTime()) return "superseded";
		blocked.set(keyOf(userId, url), blockedUntil);
		return "stored";
	};

	const readPastReadsState: ReadPastReadsState = async ({ userId, url }) => {
		const blockedUntil = blocked.get(keyOf(userId, url));
		const saved = await findSave({ userId, url });
		return {
			...computations.get(keyOf(userId, url)),
			...(saved ? { savedAt: saved.savedAt } : {}),
			...(blockedUntil !== undefined ? { budgetBlockedUntil: blockedUntil } : {}),
		};
	};

	const forgetRow = ({ userId, url }: { userId: UserId; url: string }) => {
		settled.delete(keyOf(userId, url));
		computations.delete(keyOf(userId, url));
		blocked.delete(keyOf(userId, url));
	};

	return { findPastReads, markPastReadsReady, markPastReadsBudgetBlocked, readPastReadsState, forgetRow };
}
