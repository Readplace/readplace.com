import { calculateReadTime } from "@packages/domain/article";
import { initStartAnonymousCrawl } from "./start-anonymous-crawl";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const URL_TO_CRAWL = "https://publisher.com/post";

function subject() {
	const calls: [string, unknown][] = [];
	const record = (name: string) => async (input: unknown) => {
		calls.push([name, input]);
	};
	const startAnonymousCrawl = initStartAnonymousCrawl({
		saveArticleGlobally: async (input) => {
			calls.push(["saveArticleGlobally", input]);
			return { created: true };
		},
		pinContentSource: record("pinContentSource"),
		markCrawlPending: record("markCrawlPending"),
		markSummaryPending: record("markSummaryPending"),
		publishSaveAnonymousLink: record("publishSaveAnonymousLink"),
		now: () => NOW,
	});
	return { startAnonymousCrawl, calls };
}

const STUB_SAVE = [
	"saveArticleGlobally",
	{
		url: URL_TO_CRAWL,
		metadata: { title: "publisher.com", siteName: "publisher.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
		savedAt: NOW,
	},
];

describe("initStartAnonymousCrawl", () => {
	it("stubs the article under its host before marking and requesting its crawl and summary under a fresh save attempt", async () => {
		const { startAnonymousCrawl, calls } = subject();

		await startAnonymousCrawl({ status: "resolved", url: URL_TO_CRAWL, originalUrl: URL_TO_CRAWL });

		expect(calls).toEqual([
			STUB_SAVE,
			["markCrawlPending", { url: URL_TO_CRAWL }],
			["markSummaryPending", { url: URL_TO_CRAWL }],
			[
				"publishSaveAnonymousLink",
				{ url: URL_TO_CRAWL, captureUrl: undefined, sourceOriginalUrl: undefined, saveAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
			],
		]);
	});

	it("pins an archive capture bound to the original and offers it alongside the live crawl in one save attempt", async () => {
		const { startAnonymousCrawl, calls } = subject();
		const capture = "https://web.archive.org/web/2026/https://publisher.com/post";

		await startAnonymousCrawl({
			status: "resolved",
			url: URL_TO_CRAWL,
			originalUrl: URL_TO_CRAWL,
			contentSourceUrl: capture,
			sourceOriginalUrl: URL_TO_CRAWL,
		});

		expect(calls).toEqual([
			STUB_SAVE,
			["markCrawlPending", { url: URL_TO_CRAWL }],
			["markSummaryPending", { url: URL_TO_CRAWL }],
			["pinContentSource", { articleUrl: URL_TO_CRAWL, contentSourceUrl: capture, sourceOriginalUrl: URL_TO_CRAWL }],
			[
				"publishSaveAnonymousLink",
				{ url: URL_TO_CRAWL, captureUrl: capture, sourceOriginalUrl: URL_TO_CRAWL, saveAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
			],
		]);
	});

	it("offers a non-archive wrapper body as a one-off candidate without pinning it on the article", async () => {
		const { startAnonymousCrawl, calls } = subject();
		const trackerBody = "https://click.tracker.example/r/abc";

		await startAnonymousCrawl({
			status: "resolved",
			url: URL_TO_CRAWL,
			originalUrl: URL_TO_CRAWL,
			contentSourceUrl: trackerBody,
			sourceOriginalUrl: URL_TO_CRAWL,
		});

		expect(calls).toEqual([
			STUB_SAVE,
			["markCrawlPending", { url: URL_TO_CRAWL }],
			["markSummaryPending", { url: URL_TO_CRAWL }],
			[
				"publishSaveAnonymousLink",
				{ url: URL_TO_CRAWL, captureUrl: trackerBody, sourceOriginalUrl: URL_TO_CRAWL, saveAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
			],
		]);
	});
});
