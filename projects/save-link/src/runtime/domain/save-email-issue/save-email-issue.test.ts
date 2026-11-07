import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawl, MeteredLegsMode } from "@packages/provider-contracts/article-crawl";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFindEmailIssueStanding } from "./email-issue-standing";
import { initSaveEmailIssue } from "./save-email-issue";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const ISSUE_URL = "email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const INBOX_PAGE = "https://readplace.com/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const WORK = ReadlistSlugSchema.parse("work");
const HOME = ReadlistSlugSchema.parse("home");
const METADATA = { title: "Employee #1: Yahoo", siteName: "TLDR", excerpt: "Yahoo's first employee", wordCount: 476 };
const ESTIMATED_READ_TIME = MinutesSchema.parse(2);
const PROVENANCE = { kind: "email", senderEmail: "dan@tldr.tech" } as const;

function lapsedSubscription(): SubscriptionRecord {
	return {
		userId: READER,
		provider: "stripe",
		status: "cancelled",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
}

async function harness(crawl: ArticleCrawl | undefined, opts: { beforeFiling?: () => Promise<void> } = {}) {
	const store = initInMemoryArticleStore();
	for (const slug of [WORK, HOME]) {
		await store.createReadlistDefinition({ userId: READER, slug, label: slug, createdAt: new Date() });
	}
	const calls: string[] = [];
	const displayUrls: { articleUrl: string; displayUrl: string }[] = [];
	const crawlPendingMarks: { url: string; measured: boolean; meteredLegs: MeteredLegsMode }[] = [];
	const filedInto: ReadlistSlug[] = [];
	const failFilingInto = new Set<ReadlistSlug>();
	const access: { subscription: SubscriptionRecord | undefined } = { subscription: undefined };
	const saveEmailIssue = initSaveEmailIssue({
		allocateSavedAt: store.allocateSavedAt,
		saveArticleKeepingPosition: store.saveArticleKeepingPosition,
		setDisplayUrl: async ({ articleUrl, displayUrl }) => {
			displayUrls.push({ articleUrl, displayUrl });
			await store.setDisplayUrl({ url: articleUrl, displayUrl });
		},
		findArticleCrawlStatus: async () => crawl,
		markCrawlPending: async (input) => {
			calls.push("crawl-pending");
			crawlPendingMarks.push(input);
			return { kind: "marked" };
		},
		markSummaryPending: async () => {
			calls.push("summary-pending");
		},
		fileIntoLiveReadlist: async (input) => {
			calls.push("filed");
			filedInto.push(input.readlist);
			if (failFilingInto.has(input.readlist)) throw new Error("readlist write failed");
			await opts.beforeFiling?.();
			return store.fileIntoLiveReadlist(input);
		},
		findEmailIssueStanding: initFindEmailIssueStanding({
			findStoredDisplayUrl: store.findAdoptedFetchUrl,
			listUserSavesForUrl: store.listUserSavesForUrl,
		}),
		findSubscriptionByUserId: async () => access.subscription,
		now: () => new Date(),
	});
	const requestedAt = new Date(Date.now() - 2_000);
	const save = (readlists: ReadlistSlug[], overrides: { requestedAt?: Date } = {}) =>
		saveEmailIssue({
			userId: READER,
			url: ISSUE_URL,
			displayUrl: INBOX_PAGE,
			metadata: METADATA,
			estimatedReadTime: ESTIMATED_READ_TIME,
			provenance: PROVENANCE,
			readlists,
			requestedAt: overrides.requestedAt ?? requestedAt,
			onSavedToAll: async () => {
				calls.push("saved-to-all");
			},
		});
	const seedAllSaveOnly = async () =>
		store.saveArticle({
			userId: READER,
			url: ISSUE_URL,
			metadata: METADATA,
			estimatedReadTime: ESTIMATED_READ_TIME,
			provenance: PROVENANCE,
			savedAt: await store.allocateSavedAt({ userId: READER }),
		});
	const issueId = async () => {
		const article = await store.findArticleByUrl(ISSUE_URL);
		assert(article, "the issue's article row exists");
		return article.id;
	};
	const allRow = async () => store.findArticleById(await issueId(), READER);
	const readlistRow = async (readlist: ReadlistSlug) =>
		store.findReadlistArticleById({ id: await issueId(), userId: READER, readlist });
	const removeCard = async () => store.deleteArticle(await issueId(), READER);
	const markRead = async (addressed: ReadlistSlug) =>
		store.updateArticleStatusAcrossReadlists({ id: await issueId(), userId: READER, addressed, status: "read" });
	const saves = () => store.listUserSavesForUrl({ userId: READER, url: ISSUE_URL });
	return {
		store,
		calls,
		displayUrls,
		crawlPendingMarks,
		filedInto,
		failFilingInto,
		access,
		requestedAt,
		save,
		seedAllSaveOnly,
		allRow,
		readlistRow,
		removeCard,
		markRead,
		saves,
	};
}

describe("initSaveEmailIssue", () => {
	it("saves a new issue to All with the email's metadata, marks its content and summary pending, and points it at its inbox page", async () => {
		const h = await harness(undefined);

		const outcome = await h.save([]);

		assert.deepEqual(outcome, { kind: "saved", contentPending: true, filings: [] });
		const saved = await h.store.findArticleByUrl(ISSUE_URL);
		assert.deepEqual(
			[saved?.metadata.title, saved?.metadata.siteName, saved?.metadata.wordCount, saved?.estimatedReadTime],
			["Employee #1: Yahoo", "TLDR", 476, 2],
		);
		assert.deepEqual(h.displayUrls, [{ articleUrl: ISSUE_URL, displayUrl: INBOX_PAGE }]);
		assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all"]);
		assert.deepEqual(h.crawlPendingMarks, [{ url: ISSUE_URL, measured: false, meteredLegs: "run" }]);
	});

	it("marks a still-pending issue's crawl unmeasured on a repeat save too", async () => {
		const h = await harness({ status: "pending", startedAt: "2026-11-05T10:00:00.000Z" });
		await h.save([]);
		h.calls.length = 0;
		h.crawlPendingMarks.length = 0;

		await h.save([]);

		assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all"]);
		assert.deepEqual(h.crawlPendingMarks, [{ url: ISSUE_URL, measured: false, meteredLegs: "run" }]);
	});

	it("files the issue into every custom readlist the newsletter is mapped to, as well as All", async () => {
		const h = await harness(undefined);

		const outcome = await h.save([WORK]);

		assert.deepEqual(outcome, { kind: "saved", contentPending: true, filings: [{ readlist: WORK, outcome: "filed" }] });
		assert.deepEqual(await h.saves(), [{}, { readlist: WORK }]);
	});

	it("leaves an issue whose content is already ready alone on a repeat save", async () => {
		const h = await harness({ status: "ready" });
		await h.save([]);
		h.calls.length = 0;

		const outcome = await h.save([]);

		assert.deepEqual(outcome, { kind: "saved", contentPending: false, filings: [] });
		assert.deepEqual(h.calls, ["saved-to-all"]);
	});

	it("confirms the issue is in All before filing it into a custom readlist, so a filing failure cannot hold that back", async () => {
		const h = await harness(undefined);
		h.failFilingInto.add(WORK);

		await assert.rejects(h.save([WORK]), /readlist write failed/);

		assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all", "filed"]);
		assert.notEqual(await h.store.findArticleByUrl(ISSUE_URL), undefined);
	});

	describe("run twice", () => {
		it("keeps the card's saved position and read state when the same issue is saved twice", async () => {
			const h = await harness(undefined);
			await h.save([]);
			await h.markRead(DEFAULT_READLIST_SLUG);
			const before = await h.allRow();

			await h.save([]);

			const after = await h.allRow();
			assert.deepEqual([after?.savedAt, after?.status], [before?.savedAt, "read"]);
		});

		it("keeps the readlist row's position and read state when the same issue is filed twice", async () => {
			const h = await harness(undefined);
			await h.save([WORK]);
			await h.markRead(WORK);
			const before = await h.readlistRow(WORK);
			h.calls.length = 0;

			const outcome = await h.save([WORK]);

			const after = await h.readlistRow(WORK);
			assert.deepEqual([after?.savedAt, after?.status], [before?.savedAt, "read"]);
			assert.equal(h.calls.includes("filed"), false);
			assert.deepEqual(outcome, {
				kind: "saved",
				contentPending: true,
				filings: [{ readlist: WORK, outcome: "already-filed" }],
			});
		});

		it("files only the readlist that a failed earlier receive missed", async () => {
			const h = await harness(undefined);
			h.failFilingInto.add(HOME);
			await assert.rejects(h.save([WORK, HOME]), /readlist write failed/);
			const workBefore = await h.readlistRow(WORK);
			h.failFilingInto.clear();
			h.filedInto.length = 0;

			const outcome = await h.save([WORK, HOME]);

			assert.deepEqual(h.filedInto, [HOME]);
			assert.deepEqual(outcome, {
				kind: "saved",
				contentPending: true,
				filings: [
					{ readlist: WORK, outcome: "already-filed" },
					{ readlist: HOME, outcome: "filed" },
				],
			});
			assert.deepEqual(await h.saves(), [{}, { readlist: WORK }, { readlist: HOME }]);
			assert.deepEqual((await h.readlistRow(WORK))?.savedAt, workBefore?.savedAt);
		});

		it("files the readlist an earlier receive missed as read when the reader read the issue in All after the request", async () => {
			const h = await harness(undefined);
			h.failFilingInto.add(WORK);
			await assert.rejects(h.save([WORK]), /readlist write failed/);
			await h.markRead(DEFAULT_READLIST_SLUG);
			const allBefore = await h.allRow();
			h.failFilingInto.clear();
			h.calls.length = 0;

			const outcome = await h.save([WORK]);

			assert.deepEqual(outcome, { kind: "saved", contentPending: true, filings: [{ readlist: WORK, outcome: "filed" }] });
			const work = await h.readlistRow(WORK);
			assert.deepEqual([work?.status, work?.readAt], ["read", allBefore?.readAt]);
			const allAfter = await h.allRow();
			assert.deepEqual(
				[allAfter?.savedAt, allAfter?.status, allAfter?.readAt],
				[allBefore?.savedAt, "read", allBefore?.readAt],
			);
		});

		it("files the readlist unread when the reader read the issue in All before a later request", async () => {
			const h = await harness(undefined);
			await h.save([]);
			await h.markRead(DEFAULT_READLIST_SLUG);
			const allBefore = await h.allRow();

			const outcome = await h.save([WORK], { requestedAt: new Date(Date.now() + 1_000) });

			assert.deepEqual(outcome, { kind: "saved", contentPending: true, filings: [{ readlist: WORK, outcome: "filed" }] });
			const work = await h.readlistRow(WORK);
			assert.deepEqual([work?.status, work?.readAt], ["unread", undefined]);
			const allAfter = await h.allRow();
			assert.deepEqual([allAfter?.status, allAfter?.readAt], ["read", allBefore?.readAt]);
		});
	});

	describe("run after a conflicting later fact", () => {
		it("leaves a removed card removed and finishes its pending content when the issue is redriven", async () => {
			const h = await harness(undefined);
			await h.save([WORK]);
			await h.removeCard();
			h.calls.length = 0;

			const outcome = await h.save([WORK]);

			assert.deepEqual(await h.saves(), [{ readlist: WORK }]);
			assert.deepEqual(outcome, { kind: "removed-by-reader", contentPending: true });
			assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all"]);
		});

		it("leaves a removed card removed and marks nothing when its content is already ready", async () => {
			const h = await harness({ status: "ready" });
			await h.save([]);
			await h.removeCard();
			h.calls.length = 0;

			const outcome = await h.save([]);

			assert.deepEqual(outcome, { kind: "removed-by-reader", contentPending: false });
			assert.deepEqual(h.calls, ["saved-to-all"]);
			assert.deepEqual(await h.saves(), []);
		});

		it("leaves a removed card removed however many times it is redriven", async () => {
			const h = await harness(undefined);
			await h.save([WORK]);
			await h.removeCard();

			await h.save([WORK]);
			const afterFirst = await h.saves();
			await h.save([WORK]);

			assert.deepEqual(await h.saves(), afterFirst);
			assert.deepEqual(afterFirst, [{ readlist: WORK }]);
		});

		it("leaves a readlist the reader removed the issue from alone when the issue is redriven", async () => {
			const h = await harness(undefined);
			await h.save([WORK]);
			const allBefore = await h.allRow();
			const id = (await h.readlistRow(WORK))?.id;
			assert(id);
			await h.store.deleteReadlistArticle({ id, userId: READER, readlist: WORK });
			h.calls.length = 0;

			const outcome = await h.save([WORK]);

			assert.equal(await h.readlistRow(WORK), null);
			assert.deepEqual(outcome, {
				kind: "saved",
				contentPending: true,
				filings: [{ readlist: WORK, outcome: "removed-after-request" }],
			});
			assert.deepEqual((await h.allRow())?.savedAt, allBefore?.savedAt);
		});

		it("writes no row for a readlist the reader deleted after the request", async () => {
			const h = await harness(undefined);
			h.failFilingInto.add(HOME);
			await assert.rejects(h.save([WORK, HOME]), /readlist write failed/);
			await h.store.deleteReadlistDefinition({ userId: READER, slug: HOME });
			h.failFilingInto.clear();
			h.filedInto.length = 0;
			h.calls.length = 0;

			const outcome = await h.save([WORK, HOME]);

			assert.deepEqual(outcome, {
				kind: "saved",
				contentPending: true,
				filings: [
					{ readlist: WORK, outcome: "already-filed" },
					{ readlist: HOME, outcome: "readlist-gone" },
				],
			});
			assert.equal(await h.readlistRow(HOME), null);
			assert.deepEqual(await h.saves(), [{}, { readlist: WORK }]);
		});

		it("files nothing when the reader removes the card between the save and the filing", async () => {
			const removal: { remove: () => Promise<unknown> } = { remove: async () => undefined };
			const h = await harness(undefined, { beforeFiling: async () => void (await removal.remove()) });
			removal.remove = h.removeCard;

			const outcome = await h.save([WORK]);

			assert.deepEqual(outcome, {
				kind: "saved",
				contentPending: true,
				filings: [{ readlist: WORK, outcome: "not-in-all" }],
			});
			assert.deepEqual(await h.saves(), []);
			removal.remove = async () => undefined;
			assert.equal((await h.save([WORK])).kind, "removed-by-reader");
		});
	});

	describe("healing partial states", () => {
		it("saves the card when an earlier receive wrote the article row but not the reader's row", async () => {
			const h = await harness(undefined);
			await h.store.saveArticleGlobally({
				url: ISSUE_URL,
				metadata: METADATA,
				estimatedReadTime: ESTIMATED_READ_TIME,
				savedAt: new Date(),
			});

			const outcome = await h.save([]);

			assert.equal(outcome.kind, "saved");
			assert.deepEqual(await h.saves(), [{}]);
		});

		it("writes the display URL when an earlier receive saved the card but did not reach it", async () => {
			const h = await harness(undefined);
			await h.seedAllSaveOnly();
			const before = await h.allRow();

			const outcome = await h.save([]);

			assert.equal(await h.store.findAdoptedFetchUrl(ISSUE_URL), INBOX_PAGE);
			assert.deepEqual((await h.allRow())?.savedAt, before?.savedAt);
			assert.equal(outcome.kind, "saved");
		});
	});

	describe("write access", () => {
		it("refuses a first save for a reader whose write access has lapsed", async () => {
			const h = await harness(undefined);
			h.access.subscription = lapsedSubscription();

			const outcome = await h.save([WORK]);

			assert.deepEqual(outcome, { kind: "write-access-lapsed" });
			assert.deepEqual(h.calls, []);
			assert.equal(await h.store.findArticleByUrl(ISSUE_URL), null);
			assert.deepEqual(await h.saves(), []);
		});

		it("finishes a save that landed before access lapsed", async () => {
			const h = await harness(undefined);
			h.failFilingInto.add(WORK);
			await assert.rejects(h.save([WORK]), /readlist write failed/);
			const before = await h.allRow();
			h.access.subscription = lapsedSubscription();
			h.failFilingInto.clear();
			h.calls.length = 0;

			const outcome = await h.save([WORK]);

			assert.deepEqual(outcome, { kind: "saved", contentPending: true, filings: [{ readlist: WORK, outcome: "filed" }] });
			assert.deepEqual((await h.allRow())?.savedAt, before?.savedAt);
			assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all", "filed"]);
		});

		it("leaves a removed card removed and finishes its content when access has lapsed", async () => {
			const h = await harness(undefined);
			await h.save([]);
			await h.removeCard();
			h.access.subscription = lapsedSubscription();
			h.calls.length = 0;

			const outcome = await h.save([]);

			assert.deepEqual(outcome, { kind: "removed-by-reader", contentPending: true });
			assert.deepEqual(h.calls, ["crawl-pending", "summary-pending", "saved-to-all"]);
		});
	});
});
