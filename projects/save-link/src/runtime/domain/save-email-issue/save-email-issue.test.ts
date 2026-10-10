import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { initFileArticleIntoReadlist } from "@packages/save-article";
import { initInMemoryArticleStore, noArticleTopics } from "@packages/test-fixtures/providers/article-store";
import { initSaveEmailIssue } from "./save-email-issue";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const ISSUE_URL = "email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const INBOX_PAGE = "https://readplace.com/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const WORK = ReadlistSlugSchema.parse("work");

function harness(crawl: ArticleCrawl | undefined) {
	const store = initInMemoryArticleStore({ findTopics: noArticleTopics });
	const calls: string[] = [];
	const displayUrls: { articleUrl: string; displayUrl: string }[] = [];
	const saveEmailIssue = initSaveEmailIssue({
		allocateSavedAt: store.allocateSavedAt,
		saveArticle: store.saveArticle,
		setDisplayUrl: async (input) => {
			displayUrls.push(input);
		},
		findArticleCrawlStatus: async () => crawl,
		markCrawlPending: async () => {
			calls.push("crawl-pending");
		},
		markSummaryPending: async () => {
			calls.push("summary-pending");
		},
		fileArticleIntoReadlist: initFileArticleIntoReadlist({
			allocateSavedAt: store.allocateSavedAt,
			saveReadlistArticle: store.saveReadlistArticle,
			updateArticleStatusAcrossReadlists: store.updateArticleStatusAcrossReadlists,
		}),
		publishQueueEntryCreated: async () => {
			calls.push("queue-entry-created");
		},
	});
	const save = (readlists: typeof WORK[]) =>
		saveEmailIssue({
			userId: READER,
			url: ISSUE_URL,
			displayUrl: INBOX_PAGE,
			metadata: { title: "Employee #1: Yahoo", siteName: "TLDR", excerpt: "Yahoo's first employee", wordCount: 476 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
			readlists,
		});
	return { store, calls, displayUrls, save };
}

describe("initSaveEmailIssue", () => {
	it("saves a new issue to All with the email's metadata, marks its content and summary pending, and points it at its inbox page", async () => {
		const h = harness(undefined);

		const outcome = await h.save([]);

		assert.deepEqual(outcome, { contentPending: true });
		const saved = await h.store.findArticleByUrl(ISSUE_URL);
		assert.deepEqual(
			[saved?.metadata.title, saved?.metadata.siteName, saved?.metadata.wordCount, saved?.estimatedReadTime],
			["Employee #1: Yahoo", "TLDR", 476, 2],
		);
		assert.deepEqual(h.displayUrls, [{ articleUrl: ISSUE_URL, displayUrl: INBOX_PAGE }]);
		assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "queue-entry-created"]);
	});

	it("files the issue into every custom readlist the newsletter is mapped to, as well as All", async () => {
		const h = harness(undefined);

		await h.save([WORK]);

		assert.deepEqual(await h.store.listUserSavesForUrl({ userId: READER, url: ISSUE_URL }), [{}, { readlist: WORK }]);
	});

	it("leaves an issue whose content is already ready alone, and announces no new queue entry on a repeat save", async () => {
		const h = harness({ status: "ready" });
		await h.save([]);
		h.calls.length = 0;

		const outcome = await h.save([]);

		assert.deepEqual(outcome, { contentPending: false });
		assert.deepEqual(h.calls, []);
	});
});
