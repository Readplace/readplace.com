import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	EmailLinkOrdinalSchema,
	type EmailLinkStatus,
	InboxAddressSchema,
	type InboxEmailLinkStore,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import {
	initInMemoryInboxEmail,
	initInMemoryInboxEmailLink,
} from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRecordEmailLinksFilteredHandler } from "./record-email-links-filtered-handler";

const userId = UserIdSchema.parse("user-1");
const RAM = "2026-06-24T09:00:00.000Z#<m@x>";
const WORK = ReadlistSlugSchema.parse("work");

function filteredBody(detail: {
	savedTo?: string;
	readlistLabel?: string;
	decision?: "filtered" | "no-purpose" | "readlist-missing";
	dropped: { ordinal: string; reason: string }[];
}): string {
	return JSON.stringify({
		"detail-type": "EmailLinksFiltered",
		detail: {
			userId,
			receivedAtMessageId: RAM,
			readlist: WORK,
			savedTo: detail.savedTo ?? WORK,
			readlistLabel: detail.readlistLabel ?? "Work",
			decision: detail.decision ?? "filtered",
			dropped: detail.dropped,
			inputTokens: 1200,
			outputTokens: 80,
			reasoningTokens: 400,
		},
	});
}

function filterFailedBody(): string {
	return JSON.stringify({
		"detail-type": "EmailLinksFilterFailed",
		detail: {
			userId,
			receivedAtMessageId: RAM,
			readlist: WORK,
			reason: "decider-retries-exhausted",
			receiveCount: 3,
		},
	});
}

async function seedLinks(
	store: InboxEmailLinkStore,
	rows: { ordinal: string; status: EmailLinkStatus }[],
): Promise<void> {
	for (const row of rows) {
		await store.putLink({
			userId,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse(row.ordinal),
			url: `https://example.com/post-${row.ordinal}`,
			resolvedUrl: undefined,
			status: row.status,
			title: undefined,
			excerpt: undefined,
			siteName: undefined,
			imageUrl: undefined,
			failureReason: undefined,
			skipReason: row.status === "skipped" ? "llm-ad" : undefined,
			droppedFor: undefined,
		});
	}
}

async function openDecision(
	store: InboxEmailLinkStore,
	barrier: { truncated: boolean } = { truncated: false },
): Promise<void> {
	await store.putLinksMeta({
		userId,
		receivedAtMessageId: RAM,
		meta: { truncated: barrier.truncated, extractionFailed: false, readlistDecision: { readlist: WORK } },
	});
}

async function createHandler() {
	const store = initInMemoryInboxEmailLink();
	const emails = initInMemoryInboxEmail();
	const warnings: unknown[][] = [];
	const handler = initRecordEmailLinksFilteredHandler({
		markLinkDropped: store.markLinkDropped,
		settleReadlistDecision: store.settleReadlistDecision,
		listLinksByEmail: store.listLinksByEmail,
		setEmailLinkCounts: emails.setEmailLinkCounts,
		logger: HutchLogger.from({ ...noopLogger, warn: (...args) => warnings.push(args) }),
	});
	const seedEmail = () =>
		emails.putEmail({
			userId,
			receivedAtMessageId: RAM,
			messageId: MessageIdSchema.parse("<m@x>"),
			recipientAddress: InboxAddressSchema.parse("work-abc123@read.place"),
			senderEmail: "news@example.com",
			subject: "Digest",
			status: "received",
			receivedAt: "2026-06-24T09:00:00.000Z",
			rawEmailS3Key: "inbound/m",
			bodyS3Key: "content/m/content.html",
			linkCounts: { kept: 3, skipped: 1, truncated: false },
		});
	const readCounts = async () =>
		(await emails.getEmail({ userId, receivedAtMessageId: RAM }))?.linkCounts;
	await seedEmail();
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	const read = () => store.listLinksByEmail({ userId, receivedAtMessageId: RAM });
	return { store, warnings, run, read, readCounts };
}

describe("recordEmailLinksFilteredHandler", () => {
	it("marks every dropped link for the readlist, then settles the decision as decided", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "pending" },
			{ ordinal: "0002", status: "crawled" },
		]);
		await openDecision(store);

		const result = await run([
			filteredBody({
				dropped: [
					{ ordinal: "0001", reason: "A product launch, not engineering practice" },
					{ ordinal: "0002", reason: "" },
				],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => [link.ordinal, link.droppedFor])).toEqual([
			["0000", undefined],
			[
				"0001",
				{
					readlist: WORK,
					readlistLabel: "Work",
					reason: "A product launch, not engineering practice",
				},
			],
			["0002", { readlist: WORK, readlistLabel: "Work", reason: "" }],
		]);
		expect(meta?.readlistDecision).toEqual({
			state: "decided",
			readlist: WORK,
			readlistLabel: "Work",
		});
	});

	it("settles on the readlist the links were saved to when the filter fell back to All", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);
		await openDecision(store);

		const result = await run([
			filteredBody({
				savedTo: DEFAULT_READLIST_SLUG,
				readlistLabel: "All",
				decision: "readlist-missing",
				dropped: [],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => link.droppedFor)).toEqual([undefined]);
		expect(meta?.readlistDecision).toEqual({
			state: "decided",
			readlist: DEFAULT_READLIST_SLUG,
			readlistLabel: "All",
		});
	});

	it("converges when the same fact is redelivered", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "crawled" },
		]);
		await openDecision(store);
		const body = filteredBody({ dropped: [{ ordinal: "0001", reason: "Off topic" }] });

		const first = await run([body]);
		const second = await run([body]);

		expect(first).toEqual({ batchItemFailures: [] });
		expect(second).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => link.droppedFor?.reason)).toEqual([undefined, "Off topic"]);
		expect(meta?.readlistDecision).toEqual({
			state: "decided",
			readlist: WORK,
			readlistLabel: "Work",
		});
	});

	it("fails a fact that outran the extraction barrier, then settles it on the retry", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "pending" },
		]);
		const body = filteredBody({ dropped: [{ ordinal: "0001", reason: "Off topic" }] });

		const early = await run([body]);

		expect(early).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect((await read()).meta).toBeUndefined();

		await openDecision(store);
		const retried = await run([body]);

		expect(retried).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => link.droppedFor?.reason)).toEqual([undefined, "Off topic"]);
		expect(meta?.readlistDecision).toEqual({
			state: "decided",
			readlist: WORK,
			readlistLabel: "Work",
		});
	});

	it("leaves a dropped link that is no longer a candidate alone and still settles the decision", async () => {
		const { store, warnings, run, read } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "skipped" },
		]);
		await openDecision(store);

		const result = await run([
			filteredBody({
				dropped: [
					{ ordinal: "0001", reason: "An advert" },
					{ ordinal: "0007", reason: "Never extracted" },
				],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => [link.ordinal, link.status, link.droppedFor])).toEqual([
			["0000", "crawled", undefined],
			["0001", "skipped", undefined],
		]);
		expect(meta?.readlistDecision?.state).toBe("decided");
		expect(warnings).toEqual([
			[
				"[record-email-links-filtered] dropped link is not a candidate",
				{ receivedAtMessageId: RAM, ordinal: "0001" },
			],
			[
				"[record-email-links-filtered] dropped link is not a candidate",
				{ receivedAtMessageId: RAM, ordinal: "0007" },
			],
		]);
	});

	it("records the filter giving up as a failed decision, dropping nothing", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);
		await openDecision(store);

		const result = await run([filterFailedBody()]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links.map((link) => link.droppedFor)).toEqual([undefined]);
		expect(meta?.readlistDecision).toEqual({ state: "failed", readlist: WORK });
	});

	it("keeps the decision that settled first when a later fact disagrees", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);
		await openDecision(store);

		const result = await run([filteredBody({ dropped: [] }), filterFailedBody()]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await read()).meta?.readlistDecision).toEqual({
			state: "decided",
			readlist: WORK,
			readlistLabel: "Work",
		});
	});

	it("fails a malformed fact to the DLQ without writing anything", async () => {
		const { store, run, read } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "crawled" },
		]);
		await openDecision(store);

		const result = await run([
			filteredBody({
				dropped: [
					{ ordinal: "0001", reason: "Off topic" },
					{ ordinal: "not-an-ordinal", reason: "Off topic" },
				],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		const { links, meta } = await read();
		expect(links.map((link) => link.droppedFor)).toEqual([undefined, undefined]);
		expect(meta?.readlistDecision).toEqual({ state: "deciding", readlist: WORK });
	});

	it("fails a fact whose detail-type no rule delivers, leaving the decision open", async () => {
		const { store, run, read } = await createHandler();
		await openDecision(store);

		const result = await run([
			JSON.stringify({
				"detail-type": "EmailLinksSomethingElse",
				detail: { userId, receivedAtMessageId: RAM, readlist: WORK },
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect((await read()).meta?.readlistDecision).toEqual({ state: "deciding", readlist: WORK });
	});

	it("fails a body that is not JSON to the DLQ", async () => {
		const { run } = await createHandler();

		const result = await run(["not json at all"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("recounts the email's links once the decision settles, counting dropped links as skipped", async () => {
		const { store, run, readCounts } = await createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "pending" },
			{ ordinal: "0002", status: "crawled" },
			{ ordinal: "0003", status: "skipped" },
		]);
		await openDecision(store);

		await run([
			filteredBody({
				dropped: [
					{ ordinal: "0001", reason: "Off topic" },
					{ ordinal: "0002", reason: "Off topic" },
				],
			}),
		]);

		expect(await readCounts()).toEqual({ kept: 1, skipped: 3, truncated: false });
	});

	it("carries the barrier's truncated flag into the recount", async () => {
		const { store, run, readCounts } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);
		await openDecision(store, { truncated: true });

		await run([filteredBody({ dropped: [] })]);

		expect(await readCounts()).toEqual({ kept: 1, skipped: 0, truncated: true });
	});

	it("leaves the counts alone when the filter gave up, since nothing was dropped", async () => {
		const { store, run, readCounts } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);
		await openDecision(store);

		await run([filterFailedBody()]);

		expect(await readCounts()).toEqual({ kept: 3, skipped: 1, truncated: false });
	});

	it("does not recount before the decision could settle", async () => {
		const { store, run, readCounts } = await createHandler();
		await seedLinks(store, [{ ordinal: "0000", status: "crawled" }]);

		await run([filteredBody({ dropped: [{ ordinal: "0000", reason: "Off topic" }] })]);

		expect(await readCounts()).toEqual({ kept: 3, skipped: 1, truncated: false });
	});
});
