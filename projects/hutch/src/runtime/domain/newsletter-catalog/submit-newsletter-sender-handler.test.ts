import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogDocument, NewsletterNameSchema, mergeSubmittedSender } from "@packages/domain/newsletter-catalog";
import { NewsletterSenderSubmittedEvent, SubmitNewsletterSenderCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubmitNewsletterSenderHandler } from "./submit-newsletter-sender-handler";
import { initUpdateNewsletterCatalog } from "./update-newsletter-catalog";

const TLDR = ForwardableSenderSchema.parse("dan@tldrnewsletter.com");
const MORNING_BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const OLD_BYTES = ForwardableSenderSchema.parse("old@bytes.dev");
const NOW = new Date("2026-09-30T00:00:00.000Z");
const REVIEWED_AT = "2026-09-01T00:00:00.000Z";

function submission(senderEmail: string) {
	return JSON.stringify({
		"detail-type": SubmitNewsletterSenderCommand.detailType,
		detail: { senderEmail },
	});
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function harness(initial: NewsletterCatalogDocument | undefined) {
	const catalog = initInMemoryNewsletterCatalog(initial);
	const published: { event: unknown; detail: unknown }[] = [];
	const handler = initSubmitNewsletterSenderHandler({
		updateCatalog: initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: catalog.writeCatalog,
			maxAttempts: 3,
		}),
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		now: () => NOW,
		logger: HutchLogger.from(noopLogger),
	});
	return { catalog, published, handler };
}

describe("initSubmitNewsletterSenderHandler", () => {
	it("adds a new sender as pending and reports one already in the catalog as present", async () => {
		const h = harness(undefined);

		const response = await run(h.handler, [
			{ messageId: "first", body: submission(TLDR) },
			{ messageId: "again", body: submission(TLDR) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(
			h.catalog.current()?.records.map((record) => [record.from, record.status]),
			[[TLDR, "pending"]],
		);
		assert.deepEqual(h.published, [
			{
				event: NewsletterSenderSubmittedEvent,
				detail: { senderEmail: TLDR, outcome: "created-pending" },
			},
			{
				event: NewsletterSenderSubmittedEvent,
				detail: { senderEmail: TLDR, outcome: "already-present" },
			},
		]);
	});

	it("retries a submission the catalog could not store and a malformed record", async () => {
		const h = harness(undefined);
		h.catalog.failNextWrite();

		const response = await run(h.handler, [
			{ messageId: "unavailable", body: submission(TLDR) },
			{ messageId: "bad", body: "not json" },
		]);

		assert.deepEqual(response, {
			batchItemFailures: [{ itemIdentifier: "unavailable" }, { itemIdentifier: "bad" }],
		});
		assert.deepEqual(h.published, []);
	});

	it("rebases a submission onto a catalog another writer changed first", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const published: { event: unknown; detail: unknown }[] = [];
		let raced = false;
		const racingWrite: WriteNewsletterCatalog = async (input) => {
			if (!raced) {
				raced = true;
				const competing = mergeSubmittedSender({ version: 1, records: [] }, { from: MORNING_BREW, now: NOW });
				assert(competing.ok);
				await catalog.writeCatalog({
					document: competing.document,
					expectedEtag: undefined,
				});
			}
			return catalog.writeCatalog(input);
		};
		const handler = initSubmitNewsletterSenderHandler({
			updateCatalog: initUpdateNewsletterCatalog({
				readCatalog: catalog.readCatalog,
				writeCatalog: racingWrite,
				maxAttempts: 3,
			}),
			publishEvent: (async (event, detail) => {
				published.push({ event, detail });
			}) as PublishEvent,
			now: () => NOW,
			logger: HutchLogger.from(noopLogger),
		});

		const response = await run(handler, [{ messageId: "raced", body: submission(TLDR) }]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(
			catalog.current()?.records.map((record) => [record.from, record.status]),
			[
				[MORNING_BREW, "pending"],
				[TLDR, "pending"],
			],
		);
		assert.deepEqual(published, [
			{
				event: NewsletterSenderSubmittedEvent,
				detail: { senderEmail: TLDR, outcome: "created-pending" },
			},
		]);
	});

	it("never renames an approved newsletter or reopens a rejected one", async () => {
		const reviewed: NewsletterCatalogDocument = {
			version: 1,
			records: [
				{
					from: MORNING_BREW,
					name: NewsletterNameSchema.parse("Morning Brew"),
					status: "approved",
					evidence: [
						{
							kind: "seed",
							url: "https://www.morningbrew.com/whitelist",
							note: undefined,
							addedAt: REVIEWED_AT,
						},
					],
					replacedBy: undefined,
					createdAt: REVIEWED_AT,
					updatedAt: REVIEWED_AT,
					reviewedAt: REVIEWED_AT,
				},
				{
					from: OLD_BYTES,
					name: undefined,
					status: "rejected",
					evidence: [
						{
							kind: "user-submission",
							url: undefined,
							note: undefined,
							addedAt: REVIEWED_AT,
						},
					],
					replacedBy: undefined,
					createdAt: REVIEWED_AT,
					updatedAt: REVIEWED_AT,
					reviewedAt: REVIEWED_AT,
				},
			],
		};
		const h = harness(reviewed);
		const before = h.catalog.current();

		const response = await run(h.handler, [
			{ messageId: "approved", body: submission(MORNING_BREW) },
			{ messageId: "rejected", body: submission(OLD_BYTES) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.catalog.current(), before);
		assert.deepEqual(
			before?.records.map((record) => [record.from, record.name, record.status]),
			[
				[MORNING_BREW, "Morning Brew", "approved"],
				[OLD_BYTES, undefined, "rejected"],
			],
		);
		assert.deepEqual(h.published, [
			{
				event: NewsletterSenderSubmittedEvent,
				detail: { senderEmail: MORNING_BREW, outcome: "already-present" },
			},
			{
				event: NewsletterSenderSubmittedEvent,
				detail: { senderEmail: OLD_BYTES, outcome: "already-present" },
			},
		]);
	});
});
