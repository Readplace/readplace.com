import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initCrawlEmailLinkPreviewDlqHandler } from "./crawl-email-link-preview-dlq-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RAM = "2026-06-24T09:00:00.000Z#<m@x>";
const URL = "https://example.com/post";

function commandBody(over: Partial<{ ordinal: string }> = {}): string {
	return JSON.stringify({
		detail: {
			userId: USER,
			receivedAtMessageId: RAM,
			ordinal: over.ordinal ?? "0000",
			url: URL,
		},
	});
}

async function seed(
	store: InboxEmailLinkStore,
	over: Partial<{ status: "pending" | "crawled"; title: string }> = {},
) {
	await store.putLink({
		userId: USER,
		receivedAtMessageId: RAM,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: URL,
		resolvedUrl: undefined,
		status: over.status ?? "pending",
		title: over.title,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
	});
}

function makeHandler(failPendingLink: InboxEmailLinkStore["failPendingLink"]) {
	const handler = initCrawlEmailLinkPreviewDlqHandler({
		failPendingLink,
		logger: HutchLogger.from(noopLogger),
	});
	return (body: string) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body }]), buildLambdaContext(), () => {});
}

async function getLink(store: InboxEmailLinkStore) {
	const link = await store.getLink({
		userId: USER,
		receivedAtMessageId: RAM,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
	});
	assert(link, "expected the seeded link to resolve");
	return link;
}

describe("initCrawlEmailLinkPreviewDlqHandler", () => {
	it("terminalises a link left pending by an exhausted preview command", async () => {
		const store = initInMemoryInboxEmailLink();
		await seed(store);
		const run = makeHandler(store.failPendingLink);

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("failed");
		expect(link.failureReason).toBe("preview-retries-exhausted");
	});

	it("leaves a link the crawl already finished untouched", async () => {
		const store = initInMemoryInboxEmailLink();
		await seed(store, { status: "crawled", title: "A title" });
		const run = makeHandler(store.failPendingLink);

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const link = await getLink(store);
		expect(link.status).toBe("crawled");
		expect(link.title).toBe("A title");
	});

	it("ACKs a command whose envelope does not identify a link", async () => {
		const store = initInMemoryInboxEmailLink();
		const run = makeHandler(store.failPendingLink);

		const result = await run(JSON.stringify({ detail: { wrong: "shape" } }));

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
	});

	it("ACKs a command carrying an ordinal the link table cannot key on", async () => {
		const store = initInMemoryInboxEmailLink();
		const run = makeHandler(store.failPendingLink);

		const result = await run(commandBody({ ordinal: "12" }));

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
	});

	it("fails the record when the terminal write throws", async () => {
		const run = makeHandler(async () => {
			throw new Error("ddb unavailable");
		});

		const result = await run(commandBody());

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});
});
