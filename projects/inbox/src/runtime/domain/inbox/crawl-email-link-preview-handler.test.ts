import assert from "node:assert/strict";
import type { CrawlArticle } from "@packages/crawl-article";
import {
	type CrawlAndFinalizeArticle,
	type CrawlAndFinalizeResult,
	type FinalizeArticle,
	initCrawlAndFinalizeArticle,
} from "@packages/finalize-article";
import { Logger, noopLogger } from "@packages/logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initCrawlEmailLinkPreviewHandler } from "./crawl-email-link-preview-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RAM = "2026-06-24T09:00:00.000Z#<m@x>";

function commandBody(over: Partial<{ url: string; ordinal: string }> = {}): string {
	return JSON.stringify({
		detail: {
			userId: USER,
			receivedAtMessageId: RAM,
			ordinal: over.ordinal ?? "0000",
			url: over.url ?? "https://example.com/post",
		},
	});
}

function fetched(
	metadata: { title: string; siteName: string; excerpt: string; imageUrl?: string },
	over: Partial<{ finalUrl: string }> = {},
): CrawlAndFinalizeResult {
	return {
		status: "fetched",
		bodyHash: "hash",
		finalUrl: over.finalUrl ?? "https://example.com/post",
		article: {
			html: "<p>body that is discarded</p>",
			metadata: {
				wordCount: 100,
				estimatedReadTime: 1,
				...metadata,
			},
		},
	};
}

async function seedPending(
	store: InboxEmailLinkStore,
	over: Partial<{ ordinal: string; url: string }> = {},
) {
	await store.putLink({
		userId: USER,
		receivedAtMessageId: RAM,
		ordinal: EmailLinkOrdinalSchema.parse(over.ordinal ?? "0000"),
		url: over.url ?? "https://example.com/post",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		anchorText: undefined,
	});
}

type VisibilityChange = { receiptHandle: string; visibilityTimeoutSeconds: number };

function makeHandler(deps: {
	crawlAndFinalize: CrawlAndFinalizeArticle;
	setLinkOutcome: InboxEmailLinkStore["setLinkOutcome"];
	getLink?: InboxEmailLinkStore["getLink"];
}) {
	const visibilityChanges: VisibilityChange[] = [];
	const getLinkCalls: number[] = [];
	const handler = initCrawlEmailLinkPreviewHandler({
		crawlAndFinalize: deps.crawlAndFinalize,
		setLinkOutcome: deps.setLinkOutcome,
		getLink: async (input) => {
			getLinkCalls.push(1);
			assert(deps.getLink, "this test does not expect the link row to be re-read");
			return deps.getLink(input);
		},
		changeVisibility: async (change) => {
			visibilityChanges.push(change);
		},
		random: () => 0.5,
		logger: Logger.from(noopLogger),
	});
	const run = (body: string, receiveCount = 1) => {
		const event = buildSqsEvent([{ messageId: "rec-1", body }]);
		const records = event.Records.map((record) => ({
			...record,
			attributes: { ...record.attributes, ApproximateReceiveCount: String(receiveCount) },
		}));
		return handler({ Records: records }, buildLambdaContext(), () => {});
	};
	return Object.assign(run, { visibilityChanges, getLinkCalls });
}

const transientReset: CrawlAndFinalizeResult = {
	status: "failed",
	reason: "crawl-failed",
	decision: { kind: "retryable", scope: "local", cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) },
};

async function getLink(store: InboxEmailLinkStore, ordinal = "0000") {
	const link = await store.getLink({
		userId: USER,
		receivedAtMessageId: RAM,
		ordinal: EmailLinkOrdinalSchema.parse(ordinal),
	});
	assert(link, "expected the seeded link to resolve");
	return link;
}

describe("initCrawlEmailLinkPreviewHandler", () => {
	it("stamps a crawled preview from the fetched metadata and discards the body", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () =>
				fetched({
					title: "A title",
					siteName: "Example",
					excerpt: "An excerpt",
					imageUrl: "https://cdn.test/x.jpg",
				}),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("crawled");
		expect(link.title).toBe("A title");
		expect(link.siteName).toBe("Example");
		expect(link.excerpt).toBe("An excerpt");
		expect(link.imageUrl).toBe("https://cdn.test/x.jpg");
		expect(link.resolvedUrl).toBeUndefined();
	});

	it("stamps the post-redirect destination as the resolved URL for a tracking link", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store, { url: "https://nodeweekly.com/link/187980/4be0b3f821" });
		const run = makeHandler({
			crawlAndFinalize: async () =>
				fetched(
					{ title: "A title", siteName: "Example", excerpt: "An excerpt" },
					{ finalUrl: "https://destination.test/the-actual-article" },
				),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody({ url: "https://nodeweekly.com/link/187980/4be0b3f821" }));

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("crawled");
		expect(link.url).toBe("https://nodeweekly.com/link/187980/4be0b3f821");
		expect(link.resolvedUrl).toBe("https://destination.test/the-actual-article");
	});

	it("maps a failed crawl to a failed preview and ACKs the record", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "failed", decision: undefined, reason: "crawl-failed" }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("crawl-failed");
	});

	it("maps an unsupported crawl to a failed preview", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "unsupported", reason: "pdf" }),
			setLinkOutcome: store.setLinkOutcome,
		});

		await run(commandBody());

		expect((await getLink(store)).failureReason).toBe("pdf");
	});

	it("maps a not-modified result to a failed preview for totality", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "not-modified" }),
			setLinkOutcome: store.setLinkOutcome,
		});

		await run(commandBody());

		expect((await getLink(store)).failureReason).toBe("not-modified");
	});

	it("maps a permanently-dead (404) link to a failed preview with the not-found reason and ACKs the record", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "not-found", httpStatus: 404 }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("not-found");
	});

	it("maps an edge-blocked link to a failed preview with the blocked reason and ACKs the record", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "blocked", httpStatus: 403 }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("blocked");
	});

	it("fails the record for a malformed command envelope", async () => {
		const store = initInMemoryInboxEmailLink();
		const run = makeHandler({
			crawlAndFinalize: async () => fetched({ title: "x", siteName: "y", excerpt: "z" }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(JSON.stringify({ detail: { wrong: "shape" } }));

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("fails the record when the outcome write throws", async () => {
		const run = makeHandler({
			crawlAndFinalize: async () => fetched({ title: "x", siteName: "y", excerpt: "z" }),
			setLinkOutcome: async () => {
				throw new Error("ddb unavailable");
			},
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("blocks an SSRF URL via the inherited guard, never fetching it (unsafe-url)", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		let crawlCalled = false;
		const crawlArticle: CrawlArticle = async () => {
			crawlCalled = true;
			throw new Error("must not fetch an SSRF URL");
		};
		const finalizeArticle: FinalizeArticle = async () => {
			throw new Error("must not finalize an SSRF URL");
		};
		const run = makeHandler({
			crawlAndFinalize: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody({ url: "http://169.254.169.254/latest/meta-data" }));

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(crawlCalled).toBe(false);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("unsafe-url");
	});

	it("keeps the link pending and asks for a retry when receive 1's crawl fails with a retryable decision", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({ crawlAndFinalize: async () => transientReset, setLinkOutcome: store.setLinkOutcome });

		const result = await run(commandBody(), 1);

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(run.visibilityChanges).toEqual([{ receiptHandle: "handle", visibilityTimeoutSeconds: 60 }]);
		expect((await getLink(store)).status).toBe("pending");
	});

	it("asks for a retry on receive 2 with 600 s", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => transientReset,
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const result = await run(commandBody(), 2);

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(run.visibilityChanges).toEqual([{ receiptHandle: "handle", visibilityTimeoutSeconds: 600 }]);
		expect((await getLink(store)).status).toBe("pending");
	});

	it("settles the link failed on receive 3 with the crawl's reason when the decision is still retryable", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => transientReset,
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const result = await run(commandBody(), 3);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(run.visibilityChanges).toEqual([]);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("crawl-failed");
	});

	it.each<{ name: string; decision: Extract<CrawlAndFinalizeResult, { status: "failed" }>["decision"] }>([
		{ name: "terminal", decision: { kind: "terminal", cause: new Error("certificate has expired") } },
		{ name: "cancelled", decision: { kind: "cancelled", cause: new Error("aborted") } },
		{ name: "undefined", decision: undefined },
	])("settles failed on receive 1 when the decision is $name", async ({ decision }) => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => ({ status: "failed", reason: "crawl-failed", decision }),
			setLinkOutcome: store.setLinkOutcome,
		});

		const result = await run(commandBody(), 1);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(run.visibilityChanges).toEqual([]);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("crawl-failed");
	});

	it("writes crawled on receive 2 after a retryable failure on receive 1", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const results: CrawlAndFinalizeResult[] = [
			transientReset,
			fetched({ title: "A title", siteName: "Example", excerpt: "An excerpt" }),
		];
		const run = makeHandler({
			crawlAndFinalize: async () => {
				const next = results.shift();
				assert(next, "only two crawls are expected");
				return next;
			},
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const first = await run(commandBody(), 1);
		const second = await run(commandBody(), 2);

		assert(first);
		assert(second);
		expect(first.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(second.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("crawled");
		expect(link.title).toBe("A title");
	});

	it("makes no crawl request on a redelivery when the link row is gone", async () => {
		const store = initInMemoryInboxEmailLink();
		let crawls = 0;
		const run = makeHandler({
			crawlAndFinalize: async () => {
				crawls += 1;
				return transientReset;
			},
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const result = await run(commandBody(), 2);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(crawls).toBe(0);
	});

	it.each<{ name: string; outcome: Parameters<InboxEmailLinkStore["setLinkOutcome"]>[0]["outcome"] }>([
		{
			name: "crawled",
			outcome: { status: "crawled", title: "t", excerpt: "e", siteName: "s", imageUrl: undefined, resolvedUrl: undefined },
		},
		{ name: "failed", outcome: { status: "failed", failureReason: "crawl-failed" } },
	])("makes no crawl request on a redelivery when the link is already $name", async ({ outcome }) => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		await store.setLinkOutcome({ userId: USER, receivedAtMessageId: RAM, ordinal: EmailLinkOrdinalSchema.parse("0000"), outcome });
		let crawls = 0;
		const run = makeHandler({
			crawlAndFinalize: async () => {
				crawls += 1;
				return transientReset;
			},
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const result = await run(commandBody(), 3);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(crawls).toBe(0);
		expect((await getLink(store)).status).toBe(outcome.status);
	});

	it("makes no crawl request on a redelivery when the link was skipped", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink({
			userId: USER,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			url: "https://example.com/post",
			resolvedUrl: undefined,
			status: "skipped",
			title: undefined,
			excerpt: undefined,
			siteName: undefined,
			imageUrl: undefined,
			failureReason: undefined,
			skipReason: "list-unsubscribe",
			anchorText: undefined,
		});
		let crawls = 0;
		const run = makeHandler({
			crawlAndFinalize: async () => {
				crawls += 1;
				return transientReset;
			},
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		const result = await run(commandBody(), 2);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(crawls).toBe(0);
		expect((await getLink(store)).status).toBe("skipped");
	});

	it("does not re-read the row on receive 1", async () => {
		const store = initInMemoryInboxEmailLink();
		await seedPending(store);
		const run = makeHandler({
			crawlAndFinalize: async () => fetched({ title: "x", siteName: "y", excerpt: "z" }),
			setLinkOutcome: store.setLinkOutcome,
			getLink: store.getLink,
		});

		await run(commandBody(), 1);

		expect(run.getLinkCalls).toHaveLength(0);
		expect((await getLink(store)).status).toBe("crawled");
	});
});
