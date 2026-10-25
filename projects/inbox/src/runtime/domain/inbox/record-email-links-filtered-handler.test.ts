import {
	EmailLinkOrdinalSchema,
	type EmailLinkStatus,
	type InboxEmailLinkStore,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
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
			anchorText: undefined,
		});
	}
}

async function snapshotDestinations(
	store: InboxEmailLinkStore,
	selectedReadlists: { readlist: typeof WORK; label: string }[] = [
		{ readlist: WORK, label: "Work" },
	],
): Promise<void> {
	await store.putLinksMeta({
		userId,
		receivedAtMessageId: RAM,
		meta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists,
		},
	});
}

function createHandler() {
	const store = initInMemoryInboxEmailLink();
	const handler = initRecordEmailLinksFilteredHandler({
		putReadlistOutcome: store.putReadlistOutcome,
		listLinksByEmail: store.listLinksByEmail,
		logger: HutchLogger.from(noopLogger),
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(
				bodies.map((body, index) => ({ messageId: `m-${index}`, body })),
			),
			buildLambdaContext(),
			() => {},
		);
	const read = () =>
		store.listLinksByEmail({ userId, receivedAtMessageId: RAM });
	return { store, run, read };
}

describe("recordEmailLinksFilteredHandler", () => {
	it("writes the readlist's outcome row and changes no link row", async () => {
		const { store, run, read } = createHandler();
		await seedLinks(store, [
			{ ordinal: "0000", status: "crawled" },
			{ ordinal: "0001", status: "crawled" },
		]);
		await snapshotDestinations(store);
		const before = (await read()).links;

		const result = await run([
			filteredBody({ dropped: [{ ordinal: "0001", reason: "Off topic" }] }),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { links, meta } = await read();
		expect(links).toEqual(before);
		expect(meta?.readlistOutcomes).toEqual([
			{
				readlist: WORK,
				decision: { state: "decided", readlist: WORK, readlistLabel: "Work" },
				dropped: [{ ordinal: "0001", reason: "Off topic" }],
			},
		]);
	});

	it("writes a failed outcome when the filter gave up", async () => {
		const { store, run, read } = createHandler();
		await snapshotDestinations(store);

		expect(await run([filterFailedBody()])).toEqual({ batchItemFailures: [] });
		expect((await read()).meta?.readlistOutcomes).toEqual([
			{
				readlist: WORK,
				decision: { state: "failed", readlist: WORK },
				dropped: [],
			},
		]);
	});

	it("fails a fact for an email with no destination snapshot", async () => {
		const { store, run, read } = createHandler();
		await store.putLinksMeta({
			userId,
			receivedAtMessageId: RAM,
			meta: { truncated: false, extractionFailed: false },
		});

		expect(await run([filteredBody({ dropped: [] })])).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-0" }],
		});
		expect(await run([filterFailedBody()])).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-0" }],
		});
		expect((await read()).meta?.readlistOutcomes).toBeUndefined();
	});

	it("fails a fact for a readlist outside the destination snapshot", async () => {
		const { store, run } = createHandler();
		await snapshotDestinations(store, [
			{ readlist: ReadlistSlugSchema.parse("science"), label: "Science" },
		]);

		expect(await run([filteredBody({ dropped: [] })])).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-0" }],
		});
	});

	it("retries an early fact until the destination snapshot is visible", async () => {
		const { store, run, read } = createHandler();
		const body = filteredBody({
			dropped: [{ ordinal: "0000", reason: "Outside this list" }],
		});
		expect(await run([body])).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-0" }],
		});
		await snapshotDestinations(store);
		expect(await run([body])).toEqual({ batchItemFailures: [] });
		expect((await read()).meta?.readlistOutcomes?.length).toBe(1);
	});

	it("retries a failure outcome until extraction has written its destination snapshot", async () => {
		const { run } = createHandler();
		expect(await run([filterFailedBody()])).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-0" }],
		});
	});

	it("keeps the outcome that was recorded first when a later fact disagrees", async () => {
		const { store, run, read } = createHandler();
		await snapshotDestinations(store);
		expect(await run([filterFailedBody()])).toEqual({ batchItemFailures: [] });
		await run([filteredBody({ dropped: [] })]);
		expect((await read()).meta?.readlistOutcomes).toEqual([
			{
				readlist: WORK,
				decision: { state: "failed", readlist: WORK },
				dropped: [],
			},
		]);
	});

	it("fails a malformed fact to the DLQ without writing anything", async () => {
		const { store, run, read } = createHandler();
		await snapshotDestinations(store);

		const result = await run([
			filteredBody({
				dropped: [{ ordinal: "not-an-ordinal", reason: "Off topic" }],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect((await read()).meta?.readlistOutcomes).toEqual([]);
	});

	it("fails a fact whose detail-type no rule delivers", async () => {
		const { store, run, read } = createHandler();
		await snapshotDestinations(store);

		const result = await run([
			JSON.stringify({
				"detail-type": "EmailLinksSomethingElse",
				detail: { userId, receivedAtMessageId: RAM, readlist: WORK },
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect((await read()).meta?.readlistOutcomes).toEqual([]);
	});

	it("fails a body that is not JSON to the DLQ", async () => {
		const { run } = createHandler();

		const result = await run(["not json at all"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
