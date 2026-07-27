import { noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { UserIdSchema } from "@packages/domain/user";
import { initExtractEmailLinksDlqHandler } from "./extract-email-links-dlq-handler";

const USER_ID = UserIdSchema.parse("user-1");
const RECEIVED_AT_MESSAGE_ID = "2026-07-26T11:00:00.000Z#<digest@dev>";

function eventBody(detail: Record<string, unknown>): string {
	return JSON.stringify({ detail });
}

function validEvent(): string {
	return eventBody({
		userId: USER_ID,
		receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		recipientAddress: "dev-66objr@read.place",
		origin: "receive",
	});
}

function createHandler(store = initInMemoryInboxEmailLink()): {
	store: ReturnType<typeof initInMemoryInboxEmailLink>;
	run: (bodies: string[]) => ReturnType<ReturnType<typeof initExtractEmailLinksDlqHandler>>;
} {
	const handler = initExtractEmailLinksDlqHandler({
		markLinksExtractionFailed: store.markLinksExtractionFailed,
		logger: noopLogger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	return { store, run };
}

describe("extractEmailLinksDlqHandler", () => {
	it("writes the give-up barrier so the panel stops polling and says the scan failed", async () => {
		const { store, run } = createHandler();

		const result = await run([validEvent()]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { meta } = await store.listLinksByEmail({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});
		expect(meta).toEqual({ truncated: false, extractionFailed: true });
	});

	it("leaves a completed extraction's barrier alone when a duplicate delivery gives up", async () => {
		const { store, run } = createHandler();
		await store.putLinksMeta({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			meta: { truncated: true, extractionFailed: false },
		});

		const result = await run([validEvent()]);

		expect(result).toEqual({ batchItemFailures: [] });
		const { meta } = await store.listLinksByEmail({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});
		expect(meta).toEqual({ truncated: true, extractionFailed: false });
	});

	it("fails a malformed record so its visibility is restored and the alarm can fire", async () => {
		const { store, run } = createHandler();

		const result = await run(["not json"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		const { meta } = await store.listLinksByEmail({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});
		expect(meta).toBeUndefined();
	});

	it("fails the record when the store is unavailable", async () => {
		const store = initInMemoryInboxEmailLink();
		const { run } = createHandler({
			...store,
			markLinksExtractionFailed: async () => {
				throw new Error("dynamo unavailable");
			},
		});

		const result = await run([validEvent()]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
