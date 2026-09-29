import { noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initFilterEmailLinksDlqHandler } from "./filter-email-links-dlq-handler";

const RAM = "2026-09-23T09:00:00.000Z#<m-1@example.com>";

function triagedBody(detail: Record<string, unknown>): string {
	return JSON.stringify({ detail });
}

function createHandler(publishEvent = async () => {}): {
	published: Array<{ detailType: string; detail: unknown }>;
	run: (bodies: string[]) => ReturnType<ReturnType<typeof initFilterEmailLinksDlqHandler>>;
} {
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const handler = initFilterEmailLinksDlqHandler({
		publishEvent: async (event, detail) => {
			await publishEvent();
			published.push({ detailType: event.detailType, detail });
		},
		logger: noopLogger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	return { published, run };
}

describe("filterEmailLinksDlqHandler", () => {
	it("publishes that the readlist's decision gave up, with its receive count", async () => {
		const { published, run } = createHandler();

		const result = await run([
			triagedBody({
				userId: "user-1",
				receivedAtMessageId: RAM,
				readlist: "a1b2c3d4",
				senderEmail: "news@example.com",
				subject: "Digest",
				links: [{ ordinal: "0000", url: "https://a.test/x", anchorText: "" }],
			}),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([
			{
				detailType: "EmailLinksFilterFailed",
				detail: {
					userId: "user-1",
					receivedAtMessageId: RAM,
					readlist: "a1b2c3d4",
					reason: "decision-retries-exhausted",
					receiveCount: 1,
				},
			},
		]);
	});

	it("still publishes the failure for a dead letter the filter itself could not parse", async () => {
		const { published, run } = createHandler();

		const result = await run([
			triagedBody({ userId: "user-1", receivedAtMessageId: RAM, readlist: "a1b2c3d4", links: [] }),
		]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toHaveLength(1);
	});

	it("fails a record missing the email it belongs to", async () => {
		const { published, run } = createHandler();

		const result = await run([triagedBody({ userId: "user-1", readlist: "a1b2c3d4" })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(published).toEqual([]);
	});

	it("fails the record when publishing throws", async () => {
		const { run } = createHandler(async () => {
			throw new Error("event bus unavailable");
		});

		const result = await run([
			triagedBody({ userId: "user-1", receivedAtMessageId: RAM, readlist: "a1b2c3d4" }),
		]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
