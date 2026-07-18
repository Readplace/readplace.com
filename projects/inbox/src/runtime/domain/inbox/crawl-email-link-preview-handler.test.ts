import assert from "node:assert/strict";
import type { CrawlArticle } from "@packages/crawl-article";
import {
	type CrawlAndFinalizeArticle,
	type CrawlAndFinalizeResult,
	type FinalizeArticle,
	initCrawlAndFinalizeArticle,
} from "@packages/finalize-article";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
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
	});
}

function makeHandler(deps: {
	crawlAndFinalize: CrawlAndFinalizeArticle;
	setLinkOutcome: InboxEmailLinkStore["setLinkOutcome"];
}) {
	const handler = initCrawlEmailLinkPreviewHandler({
		crawlAndFinalize: deps.crawlAndFinalize,
		setLinkOutcome: deps.setLinkOutcome,
		logger: HutchLogger.from(noopLogger),
	});
	return (body: string) => handler(buildSqsEvent([{ messageId: "rec-1", body }]), buildLambdaContext(), () => {});
}

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
			crawlAndFinalize: async () => ({ status: "failed", reason: "crawl-failed" }),
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
});
