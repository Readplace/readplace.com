import { NoSuchKey } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, validateSaveableUrl } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { initStartAnonymousCrawl } from "@packages/save-article";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryArticleStore, noArticleTopics } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { initS3HnSnapshot } from "../../providers/hn-snapshot/s3-hn-snapshot";
import { initHnSnapshot } from "./hn-snapshot";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const resolvedAs = (url: string) => ({ status: "resolved" as const, url, originalUrl: url });
const DAY = "2026-10-10";

function subject(input: Partial<Parameters<typeof initHnSnapshot>[0]> = {}) {
	const clock = { now: NOW };
	const objects = new Map<string, string>();
	const store = initS3HnSnapshot({
		bucketName: "content",
		get: async (command) => {
			const value = objects.get(String(command.input.Key));
			if (value === undefined) throw new NoSuchKey({ message: "missing", $metadata: {} });
			return { Body: { transformToString: async () => value } };
		},
		put: async (command) => {
			const key = String(command.input.Key);
			if (command.input.IfNoneMatch === "*" && objects.has(key)) {
				throw Object.assign(new Error("exists"), { name: "PreconditionFailed" });
			}
			objects.set(key, String(command.input.Body));
		},
	});
	const articles = initInMemoryArticleStore({ findTopics: noArticleTopics });
	const crawl = initInMemoryArticleCrawl();
	const summaries = initInMemoryGeneratedSummary();
	const items = new Map<number, unknown>();
	const published: string[] = [];
	const requests: string[] = [];
	const deps: Parameters<typeof initHnSnapshot>[0] = {
		store,
		fetch: async (url) => {
			const path = String(url);
			requests.push(path);
			const id = Number(path.match(/item\/(\d+)\.json/)?.[1]);
			return new Response(
				JSON.stringify(path.endsWith("topstories.json") ? [...items.keys()] : items.get(id)),
			);
		},
		validateSaveableUrl,
		resolveSaveIdentity: async (url) => resolvedAs(url),
		findArticleByUrl: articles.findArticleByUrl,
		findArticleCrawlStatus: crawl.findArticleCrawlStatus,
		readArticleContent: async (url) => articles.readContent(ArticleResourceUniqueId.parse(url)),
		findGeneratedSummary: summaries.findGeneratedSummary,
		startAnonymousCrawl: initStartAnonymousCrawl({
			saveArticleGlobally: articles.saveArticleGlobally,
			pinContentSource: articles.pinContentSource,
			markCrawlPending: crawl.markCrawlPending,
			markSummaryPending: summaries.markSummaryPending,
			publishSaveAnonymousLink: async ({ url, captureUrl }) => {
				published.push(captureUrl ?? url);
			},
			now: () => clock.now,
		}),
		now: () => clock.now,
		logger: noopLogger,
		...input,
	};
	const crawled = async (url: string) => {
		await crawl.markCrawlReady({ url });
		await articles.setReaderAvailableAt({ url, at: clock.now });
		await articles.writeContent({ url, content: "<p>Readable article</p>" });
	};
	const summarised = (url: string) => summaries.markSummaryReady({ url, summary: "Ready summary", topics: [] });
	const savedByReader = async (url: string) => {
		await articles.saveArticleGlobally({
			url,
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			savedAt: NOW,
		});
	};
	return {
		...initHnSnapshot(deps),
		deps,
		clock,
		store,
		articles,
		crawl,
		summaries,
		items,
		published,
		requests,
		crawled,
		summarised,
		savedByReader,
		statuses: async (day = DAY) => (await store.find(day))?.items.map((item) => item.status),
	};
}

describe("shared HN preparation", () => {
	it("captures the first thirty ranked entries once and stubs each new story before requesting its crawl", async () => {
		const app = subject();
		for (let id = 1; id <= 35; id++)
			app.items.set(id, { id, type: "story", url: `https://publisher.com/${id}` });
		await app.prepareSnapshot();
		const snapshot = await app.store.find(DAY);
		expect(snapshot?.items).toHaveLength(30);
		expect(snapshot?.items[29]).toMatchObject({ hnItemId: 30, rank: 30, status: "pending" });
		expect(app.published).toHaveLength(30);
		const stub = await app.articles.findArticleByUrl("https://publisher.com/30");
		expect(stub?.url).toBe("https://publisher.com/30");
		expect(await app.crawl.findArticleCrawlStatus("https://publisher.com/30")).toEqual({
			status: "pending",
		});
		expect(await app.summaries.findGeneratedSummary("https://publisher.com/30")).toEqual({
			status: "pending",
		});
		expect(await app.findReadySnapshot()).toEqual([]);
		await app.crawled("https://publisher.com/1");
		await app.summarised("https://publisher.com/1");
		await app.prepareSnapshot();
		expect(app.requests).toHaveLength(31);
		expect(app.published).toHaveLength(30);
		expect(await app.findReadySnapshot()).toEqual([
			{ url: "https://publisher.com/1", hnItemId: 1, rank: 1, snapshotAt: NOW.toISOString() },
		]);
	});
	it("pins an archive capture when it requests the original's crawl", async () => {
		const capture = "https://web.archive.org/web/2026/https://publisher.com/archived";
		const app = subject({
			resolveSaveIdentity: async () => ({
				...resolvedAs("https://publisher.com/archived"),
				contentSourceUrl: capture,
				sourceOriginalUrl: "https://publisher.com/archived",
			}),
		});
		app.items.set(1, { id: 1, type: "story", url: capture });
		await app.prepareSnapshot();
		expect(app.published).toEqual([capture]);
		expect(await app.statuses()).toEqual(["pending"]);
	});
	it("skips a story whose wrapper link does not resolve to an original article", async () => {
		const wrapper = "https://t.co/unresolvable";
		const app = subject({
			resolveSaveIdentity: async () => ({ status: "unresolved" }),
		});
		app.items.set(1, { id: 1, type: "story", url: wrapper });
		await app.prepareSnapshot();
		expect(app.published).toEqual([]);
		expect(await app.statuses()).toEqual(["skipped"]);
	});
	it("filters jobs, dead/deleted stories, discussions, unsupported URLs and missing items without losing rank", async () => {
		const app = subject();
		const candidates = [
			null,
			{ type: "job", url: "https://publisher.com/job" },
			{ type: "story", dead: true, url: "https://publisher.com/dead" },
			{ type: "story", deleted: true },
			{ type: "story" },
			{ type: "story", url: "ftp://publisher.com/file" },
			{ type: "story", url: "https://mail.google.com/mail" },
			{ type: "story", url: "https://news.ycombinator.com/item?id=1" },
			{ type: "story", url: "https://publisher.com/article" },
		];
		candidates.forEach((item, i) => {
			app.items.set(i + 1, item === null ? null : { id: i + 1, ...item });
		});
		await app.prepareSnapshot();
		expect(await app.statuses()).toEqual([...Array(8).fill("skipped"), "pending"]);
		expect(app.published).toEqual(["https://publisher.com/article"]);
		expect((await app.store.find(DAY))?.items.at(-1)?.rank).toBe(9);
	});
	it("deduplicates canonical redirects in rank order and skips purged and unsupported destinations", async () => {
		const app = subject({
			resolveSaveIdentity: async (url) =>
				resolvedAs(
					url.endsWith("second")
						? "https://publisher.com/first"
						: url.endsWith("private")
							? "http://localhost/private"
							: url,
				),
		});
		for (const [i, slug] of ["first", "second", "purged", "private"].entries())
			app.items.set(i + 1, { id: i + 1, type: "story", url: `https://publisher.com/${slug}` });
		for (const url of ["https://publisher.com/first", "https://publisher.com/purged"]) {
			await app.savedByReader(url);
			await app.crawled(url);
			await app.summarised(url);
		}
		app.deps.findArticleByUrl = async (url) => {
			const article = await app.articles.findArticleByUrl(url);
			return url.endsWith("purged") && article ? { ...article, purgedAt: NOW } : article;
		};
		await initHnSnapshot(app.deps).prepareSnapshot();
		expect(await app.statuses()).toEqual(["ready", "skipped", "skipped", "skipped"]);
		expect(app.published).toEqual([]);
		expect(await app.findReadySnapshot()).toHaveLength(1);
	});
	it("does not request another crawl for a story whose crawl or summary ended, or whose crawl is in flight", async () => {
		const app = subject({
			findGeneratedSummary: async (url) =>
				url.endsWith("summary-failed")
					? { status: "failed", reason: "provider-error" }
					: app.summaries.findGeneratedSummary(url),
		});
		const slugs = ["crawl-failed", "crawl-unsupported", "summary-skipped", "summary-failed", "in-flight"];
		for (const [i, slug] of slugs.entries()) {
			const url = `https://publisher.com/${slug}`;
			app.items.set(i + 1, { id: i + 1, type: "story", url });
			await app.savedByReader(url);
		}
		await app.crawl.markCrawlFailed({ url: "https://publisher.com/crawl-failed", reason: "blocked" });
		await app.crawl.markCrawlUnsupported({
			url: "https://publisher.com/crawl-unsupported",
			reason: "too-large",
		});
		await app.crawled("https://publisher.com/summary-skipped");
		await app.summaries.markSummarySkipped({
			url: "https://publisher.com/summary-skipped",
			reason: "content-too-short",
		});
		await app.crawled("https://publisher.com/summary-failed");
		await app.crawl.markCrawlPending({ url: "https://publisher.com/in-flight" });
		await app.prepareSnapshot();
		expect(await app.statuses()).toEqual(["skipped", "skipped", "skipped", "skipped", "pending"]);
		expect(app.published).toEqual([]);
	});
	it("isolates API and preparation failures so another item can become ready", async () => {
		const app = subject();
		app.deps.fetch = async (url) =>
			String(url).endsWith("topstories.json")
				? new Response("[1,2,3]")
				: String(url).includes("item/1")
					? new Response("offline", { status: 503 })
					: new Response(
							JSON.stringify({
								id: 2,
								type: "story",
								url: String(url).includes("item/2")
									? "https://publisher.com/canonical-failure"
									: "https://publisher.com/summary-failure",
							}),
						);
		app.deps.resolveSaveIdentity = async (url) => {
			if (url.endsWith("canonical-failure")) throw new Error("resolve failed");
			return resolvedAs(url);
		};
		app.deps.findGeneratedSummary = async () => {
			throw new Error("summary failed");
		};
		await initHnSnapshot(app.deps).prepareSnapshot();
		expect(await app.statuses()).toEqual(["failed", "failed", "failed"]);
		await expect(
			subject({ fetch: async () => new Response("rate limit", { status: 429 }) }).prepareSnapshot(),
		).rejects.toThrow("429");
	});
	it("requires both readable content and a ready summary", async () => {
		const app = subject();
		app.items.set(1, { id: 1, type: "story", url: "https://publisher.com/1" });
		await app.prepareSnapshot();
		await app.crawled("https://publisher.com/1");
		await app.prepareSnapshot();
		expect(await app.statuses()).toEqual(["pending"]);
		await app.summarised("https://publisher.com/1");
		await initHnSnapshot({ ...app.deps, readArticleContent: async () => "" }).prepareSnapshot();
		expect(await app.statuses()).toEqual(["pending"]);
		await app.prepareSnapshot();
		expect(await app.statuses()).toEqual(["ready"]);
		expect(app.published).toEqual(["https://publisher.com/1"]);
	});
	it("offers picks only from the current UTC day's snapshot", async () => {
		const app = subject();
		app.items.set(1, { id: 1, type: "story", url: "https://publisher.com/1" });
		await app.savedByReader("https://publisher.com/1");
		await app.crawled("https://publisher.com/1");
		await app.summarised("https://publisher.com/1");
		await app.prepareSnapshot();
		expect(await app.findReadySnapshot()).toHaveLength(1);
		app.clock.now = new Date("2026-10-11T00:00:00.000Z");
		expect(await app.findReadySnapshot()).toEqual([]);
		await app.prepareSnapshot();
		expect(await app.findReadySnapshot()).toEqual([
			{
				url: "https://publisher.com/1",
				hnItemId: 1,
				rank: 1,
				snapshotAt: "2026-10-11T00:00:00.000Z",
			},
		]);
	});
});
