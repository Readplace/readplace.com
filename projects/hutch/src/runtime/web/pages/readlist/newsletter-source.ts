import { discoveryCandidateOf, matchesArticleDiscovery, ReaderArticleHashId, type SavedArticle } from "@packages/domain/article";
import type { InboxEmailStore, InboxEmailLinkStore, InboxEmailsCursor } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { CountArticlesByUser, FindArticleById, FindArticlesByUser, ResolveCanonicalIdentity } from "@packages/provider-contracts/article-store";

export interface NewsletterSourceDependencies {
	listSenderIssues: InboxEmailStore["listEmailsByUserId"];
	listIssueLinks: InboxEmailLinkStore["listLinksByEmail"];
	resolveCanonicalIdentity: ResolveCanonicalIdentity;
	findArticleById: FindArticleById;
}

async function senderArticles(deps: NewsletterSourceDependencies, userId: UserId, sender: string) {
	const articles = new Map<string, SavedArticle>();
	const canonical = new Map<string, Promise<ReaderArticleHashId>>();
	const owned = new Map<string, Promise<SavedArticle | null>>();
	async function find(url: string) {
		let identity = canonical.get(url);
		if (!identity) {
			identity = deps.resolveCanonicalIdentity(url).then(key => ReaderArticleHashId.from(key));
			canonical.set(url, identity);
		}
		const id = await identity;
		let saved = owned.get(id.value);
		if (!saved) {
			saved = deps.findArticleById(id, userId);
			owned.set(id.value, saved);
		}
		return saved;
	}
	let cursor: InboxEmailsCursor | undefined;
	do {
		const page = await deps.listSenderIssues({ userId, sender, cursor, pageSize: 10 });
		const issues = await Promise.all(page.emails.map(issue => deps.listIssueLinks({ userId, receivedAtMessageId: issue.receivedAtMessageId })));
		const occurrences = issues.flatMap(issue => issue.links);
		for (let start = 0; start < occurrences.length; start += 8) {
			await Promise.all(occurrences.slice(start, start + 8).map(async link => {
				for (const url of new Set([link.resolvedUrl, link.url])) {
					if (!url || !URL.canParse(url)) continue;
					const saved = await find(url);
					if (saved) {
						articles.set(saved.id.value, saved);
						return;
					}
				}
			}));
		}
		const last = page.emails.at(-1);
		cursor = page.hasOlder && last ? { direction: "older", receivedAtMessageId: last.receivedAtMessageId } : undefined;
	} while (cursor);
	return [...articles.values()];
}

export function newsletterSourceStore(deps: NewsletterSourceDependencies, sender: string | undefined): {
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
} {
	const byUser = new Map<UserId, Promise<SavedArticle[]>>();
	const matching = async (query: Parameters<CountArticlesByUser>[0]) => {
		if (!sender) return [];
		let rows = byUser.get(query.userId);
		if (!rows) {
			rows = senderArticles(deps, query.userId, sender);
			byUser.set(query.userId, rows);
		}
		return (await rows).filter(article => (!query.status || article.status === query.status)
			&& (!query.discovery || matchesArticleDiscovery(discoveryCandidateOf(article), query.discovery)));
	};
	return {
		countArticlesByUser: async query => Math.min((await matching(query)).length, query.countLimit ?? Infinity),
		findArticlesByUser: async query => {
			const rows = await matching(query);
			const at = (article: SavedArticle) => (query.sort === "readAt" ? article.readAt ?? article.savedAt : article.savedAt).getTime();
			const direction = query.order === "asc" ? 1 : -1;
			rows.sort((a, b) => direction * (at(a) - at(b) || a.id.value.localeCompare(b.id.value)));
			const page = query.page ?? 1;
			const pageSize = query.pageSize ?? 20;
			return { articles: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, hasMore: page * pageSize < rows.length, page, pageSize };
		},
	};
}
