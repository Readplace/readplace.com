import type { SQSEvent, SQSRecord } from "aws-lambda";
import {
	CanonicalContentChangedEvent,
	ComputeRelatedPastReadsCommand,
	QueueEntryCreatedEvent,
} from "@packages/hutch-infra-components";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initComputeRelatedPasses } from "./compute-related-passes";

const record = ({ messageId, detailType }: { messageId: string; detailType: string }): SQSRecord => ({
	messageId,
	body: JSON.stringify({ "detail-type": detailType }),
	receiptHandle: "receipt",
	attributes: {
		ApproximateReceiveCount: "1",
		SentTimestamp: "0",
		SenderId: "test",
		ApproximateFirstReceiveTimestamp: "0",
	},
	messageAttributes: {},
	md5OfBody: "",
	eventSource: "aws:sqs",
	eventSourceARN: "arn:aws:sqs:ap-southeast-2:000000000000:related",
	awsRegion: "ap-southeast-2",
});
const saved = record({ messageId: "saved", detailType: QueueEntryCreatedEvent.detailType });
const refresh = record({ messageId: "refresh", detailType: ComputeRelatedPastReadsCommand.detailType });
const contentChanged = record({ messageId: "content-changed", detailType: CanonicalContentChangedEvent.detailType });
const event: SQSEvent = { Records: [saved, refresh, contentChanged, record({ messageId: "other", detailType: "other" })] };

describe("related computation passes", () => {
	it("starts every pass before any finishes and unions failures across the three passes", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const calls: SQSEvent[] = [];
		const handler = initComputeRelatedPasses({
			nextReadHandler: async (e) => {
				calls.push(e);
				await gate;
				return { batchItemFailures: [{ itemIdentifier: "saved" }] };
			},
			pastReadsHandler: async (e) => {
				calls.push(e);
				release();
				return {
					batchItemFailures: [
						{ itemIdentifier: "saved" },
						{ itemIdentifier: "refresh" },
					],
				};
			},
			recomputeNextReadHandler: async (e) => {
				calls.push(e);
				return { batchItemFailures: [{ itemIdentifier: "content-changed" }] };
			},
		});
		expect(await handler(event, buildLambdaContext(), () => {})).toEqual({
			batchItemFailures: [
				{ itemIdentifier: "saved" },
				{ itemIdentifier: "refresh" },
				{ itemIdentifier: "content-changed" },
			],
		});
		expect(calls).toEqual([
			{ Records: [saved] },
			{ Records: [saved, refresh] },
			{ Records: [contentChanged] },
		]);
	});
	it("sends a CanonicalContentChanged record only to the recompute pass", async () => {
		const received: Record<string, SQSRecord[]> = {};
		const handler = initComputeRelatedPasses({
			nextReadHandler: async (e) => {
				received.nextRead = e.Records;
				return { batchItemFailures: [] };
			},
			pastReadsHandler: async (e) => {
				received.pastReads = e.Records;
				return { batchItemFailures: [] };
			},
			recomputeNextReadHandler: async (e) => {
				received.recompute = e.Records;
				return { batchItemFailures: [] };
			},
		});
		await handler({ Records: [contentChanged] }, buildLambdaContext(), () => {});
		expect(received).toEqual({ nextRead: [], pastReads: [], recompute: [contentChanged] });
	});
	it("accepts successful passes including callback-style handlers", async () => {
		const handler = initComputeRelatedPasses({
			nextReadHandler: () => {},
			pastReadsHandler: async () => ({ batchItemFailures: [] }),
			recomputeNextReadHandler: async () => ({ batchItemFailures: [] }),
		});
		expect(
			await handler({ Records: [] }, buildLambdaContext(), () => {}),
		).toEqual({ batchItemFailures: [] });
	});
	it("propagates an unexpected pass rejection", async () => {
		const handler = initComputeRelatedPasses({
			nextReadHandler: async () => {
				throw new Error("failed");
			},
			pastReadsHandler: async () => ({ batchItemFailures: [] }),
			recomputeNextReadHandler: async () => ({ batchItemFailures: [] }),
		});
		await expect(
			handler(event, buildLambdaContext(), () => {}),
		).rejects.toThrow("failed");
	});
});
