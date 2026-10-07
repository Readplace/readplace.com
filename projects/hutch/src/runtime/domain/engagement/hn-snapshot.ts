import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { isNonArticleHost, type ValidateSaveableUrl } from "@packages/domain/article";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { FindArticleByUrl, ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { StarterPick } from "@packages/provider-contracts/engagement-starter";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ResolveSaveIdentity, StartAnonymousCrawl } from "@packages/save-article";

const HnItemSchema = z
	.object({
		id: z.number(),
		type: z.string().optional(),
		url: z.string().optional(),
		deleted: z.boolean().optional(),
		dead: z.boolean().optional(),
	})
	.nullable();
export const HnSnapshotSchema = z.object({
	snapshotAt: z.string(),
	items: z.array(
		z.object({
			hnItemId: z.number(),
			rank: z.number(),
			url: z.string().optional(),
			canonicalUrl: z.string().optional(),
			status: z.enum(["pending", "ready", "skipped", "failed"]),
		}),
	),
});
export type HnSnapshot = z.infer<typeof HnSnapshotSchema>;
export interface HnSnapshotStore {
	find: (day: string) => Promise<HnSnapshot | undefined>;
	create: (input: { day: string; snapshot: HnSnapshot }) => Promise<HnSnapshot>;
	update: (input: { day: string; snapshot: HnSnapshot }) => Promise<void>;
}

const snapshotDayOf = (at: Date) => at.toISOString().slice(0, 10);

export function initFindReadySnapshot(deps: {
	store: HnSnapshotStore;
	now: () => Date;
}): () => Promise<StarterPick[]> {
	return async () => {
		const snapshot = await deps.store.find(snapshotDayOf(deps.now()));
		if (snapshot === undefined) return [];
		return snapshot.items.flatMap((item) =>
			item.status === "ready" && item.canonicalUrl !== undefined
				? [
						{
							url: item.canonicalUrl,
							hnItemId: item.hnItemId,
							rank: item.rank,
							snapshotAt: snapshot.snapshotAt,
						},
					]
				: [],
		);
	};
}

export function initHnSnapshot(deps: {
	store: HnSnapshotStore;
	fetch: typeof fetch;
	validateSaveableUrl: ValidateSaveableUrl;
	resolveSaveIdentity: ResolveSaveIdentity;
	findArticleByUrl: FindArticleByUrl;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	startAnonymousCrawl: StartAnonymousCrawl;
	now: () => Date;
	logger: HutchLogger;
}): { prepareSnapshot: () => Promise<void>; findReadySnapshot: () => Promise<StarterPick[]> } {
	const readJson = async (path: string) => {
		const response = await deps.fetch(`https://hacker-news.firebaseio.com/v0/${path}.json`, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`HN API returned ${response.status}`);
		return response.json();
	};
	const capture = async (): Promise<HnSnapshot> => {
		const ids = z
			.array(z.number())
			.parse(await readJson("topstories"))
			.slice(0, 30);
		const snapshotAt = deps.now().toISOString();
		const items = await Promise.all(
			ids.map(async (id, index): Promise<HnSnapshot["items"][number]> => {
				const ranked = { hnItemId: id, rank: index + 1 };
				try {
					const item = HnItemSchema.parse(await readJson(`item/${id}`));
					if (item?.type !== "story" || item.deleted || item.dead || item.url === undefined) {
						return { ...ranked, status: "skipped" };
					}
					const validation = deps.validateSaveableUrl(item.url);
					if (
						validation.status !== "SUCCESS" ||
						isNonArticleHost(item.url) ||
						new URL(item.url).hostname === "news.ycombinator.com"
					) {
						return { ...ranked, status: "skipped" };
					}
					return { ...ranked, url: validation.url, status: "pending" };
				} catch (error) {
					deps.logger.error("[HnSnapshot] item capture failed", { hnItemId: id, error });
					return { ...ranked, status: "failed" };
				}
			}),
		);
		return { snapshotAt, items };
	};
	const prepareSnapshot = async () => {
		const snapshotDay = snapshotDayOf(deps.now());
		const snapshot =
			(await deps.store.find(snapshotDay)) ??
			(await deps.store.create({ day: snapshotDay, snapshot: await capture() }));
		const resolved = await Promise.all(
			snapshot.items.map(async (item) => {
				if (item.url === undefined) return { item };
				try {
					const identity = await deps.resolveSaveIdentity(item.url);
					if (identity.status === "unresolved") return { item: { ...item, status: "skipped" as const } };
					return { item, identity, article: await deps.findArticleByUrl(identity.url) };
				} catch (error) {
					deps.logger.error("[HnSnapshot] canonical preparation failed", {
						hnItemId: item.hnItemId,
						error,
					});
					return { item: { ...item, status: "failed" as const } };
				}
			}),
		);
		const seen = new Set<string>();
		const items = await Promise.all(
			resolved.map(async ({ item, identity, article }): Promise<HnSnapshot["items"][number]> => {
				if (identity === undefined) return item;
				const { url } = identity;
				if (
					article?.purgedAt !== undefined ||
					deps.validateSaveableUrl(url).status !== "SUCCESS" ||
					isNonArticleHost(url) ||
					new URL(url).hostname === "news.ycombinator.com"
				) {
					return { ...item, status: "skipped" };
				}
				const canonicalKey = ArticleResourceUniqueId.parse(article?.destinationUrl ?? url).value;
				if (seen.has(canonicalKey)) return { ...item, status: "skipped" };
				seen.add(canonicalKey);
				try {
					const [crawl, summary, content] = await Promise.all([
						deps.findArticleCrawlStatus(url),
						deps.findGeneratedSummary(url),
						article?.readerAvailableAt === undefined
							? Promise.resolve(undefined)
							: deps.readArticleContent(url),
					]);
					if (article === null && crawl === undefined) {
						await deps.startAnonymousCrawl(identity);
						return { ...item, status: "pending" };
					}
					if (article?.readerAvailableAt !== undefined && content && summary?.status === "ready") {
						return { ...item, canonicalUrl: article.url, status: "ready" };
					}
					if (
						crawl?.status === "failed" ||
						crawl?.status === "unsupported" ||
						summary?.status === "failed" ||
						summary?.status === "skipped"
					) {
						return { ...item, status: "skipped" };
					}
					return { ...item, status: "pending" };
				} catch (error) {
					deps.logger.error("[HnSnapshot] preparation failed", { hnItemId: item.hnItemId, error });
					return { ...item, status: "failed" };
				}
			}),
		);
		await deps.store.update({ day: snapshotDay, snapshot: { ...snapshot, items } });
	};
	return { prepareSnapshot, findReadySnapshot: initFindReadySnapshot(deps) };
}
