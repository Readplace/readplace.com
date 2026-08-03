import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxSavedLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRecordLinkQueuedHandler } from "./record-link-queued-handler";

const userId = UserIdSchema.parse("user-1");
const logger = HutchLogger.from(noopLogger);
const POST_URL = "https://example.com/post";

function queuedBody(url: string): string {
	return JSON.stringify({ "detail-type": "LinkQueued", detail: { url, userId } });
}

function failedBody(url: string): string {
	return JSON.stringify({
		"detail-type": "LinkQueueFailed",
		detail: { url, userId, reason: "accept-retries-exhausted", receiveCount: 3 },
	});
}

function dequeuedBody(url: string): string {
	return JSON.stringify({ "detail-type": "LinkDequeued", detail: { url, userId } });
}

function createHandler() {
	const store = initInMemoryInboxSavedLink();
	const handler = initRecordLinkQueuedHandler({
		markLinkSaved: store.markLinkSaved,
		markLinkSaveFailed: store.markLinkSaveFailed,
		retractLinkSaved: store.retractLinkSaved,
		logger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	return { store, run };
}

describe("recordLinkQueuedHandler", () => {
	it("records an accepted save and acknowledges the record", async () => {
		const { store, run } = createHandler();

		const result = await run([queuedBody(POST_URL)]);

		expect(result).toEqual({ batchItemFailures: [] });
		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("saved");
	});

	it("records a save failure from the failure fact", async () => {
		const { store, run } = createHandler();

		await run([failedBody(POST_URL)]);

		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("failed");
	});

	it("keeps the link saved when the command dead-letters after the queue row was written", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL)]);
		await run([failedBody(POST_URL)]);

		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("saved");
	});

	it("converges when the same fact is redelivered", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL), queuedBody(POST_URL)]);

		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("saved");
	});

	it("fails a malformed detail to the DLQ without writing", async () => {
		const { store, run } = createHandler();

		const result = await run([
			JSON.stringify({ "detail-type": "LinkQueued", detail: { url: POST_URL } }),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect((await store.findSavedLinks({ userId, urls: [POST_URL] })).size).toBe(0);
	});

	it("fails a body that is not JSON to the DLQ", async () => {
		const { run } = createHandler();

		const result = await run(["not json at all"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails the record when the store write throws", async () => {
		const handler = initRecordLinkQueuedHandler({
			markLinkSaved: async () => {
				throw new Error("dynamo unavailable");
			},
			markLinkSaveFailed: async () => {},
			retractLinkSaved: async () => {},
			logger,
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "m-0", body: queuedBody(POST_URL) }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails a record whose url cannot be keyed", async () => {
		const { run } = createHandler();

		const result = await run([queuedBody("not a url")]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});

describe("recordLinkQueuedHandler retraction", () => {
	it("stops reading saved once the reader deletes the queue row", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL)]);
		const result = await run([dequeuedBody(POST_URL)]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await store.findSavedLinks({ userId, urls: [POST_URL] })).size).toBe(0);
	});

	it("re-reads saved when the reader saves the link again after deleting it", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL), dequeuedBody(POST_URL), queuedBody(POST_URL)]);

		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("saved");
	});

	it("converges when the deletion fact is redelivered", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL)]);
		const result = await run([dequeuedBody(POST_URL), dequeuedBody(POST_URL)]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await store.findSavedLinks({ userId, urls: [POST_URL] })).size).toBe(0);
	});

	it("acknowledges a deletion for a link this reader never saved from here", async () => {
		const { store, run } = createHandler();

		const result = await run([dequeuedBody("https://example.com/never-saved")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await store.findSavedLinks({ userId, urls: [POST_URL] })).size).toBe(0);
	});

	it("fails a fact whose detail-type no rule delivers, leaving the record saved", async () => {
		const { store, run } = createHandler();

		await run([queuedBody(POST_URL)]);
		const result = await run([
			JSON.stringify({ "detail-type": "LinkSomethingElse", detail: { url: POST_URL, userId } }),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		const states = await store.findSavedLinks({ userId, urls: [POST_URL] });
		expect(states.get(POST_URL)).toBe("saved");
	});
});
