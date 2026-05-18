import { SQSClient } from "@aws-sdk/client-sqs";
import {
	EventBridgeClient,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import {
	initDispatchComprehensiveCrawl,
	initEventsDepBundle,
} from "./events";

describe("initEventsDepBundle", () => {
	it("returns a bundle with publishEvent and dispatchGenerateSummary fields", () => {
		const bundle = initEventsDepBundle({
			eventBridgeClient: new EventBridgeClient({ region: "us-east-1" }),
			eventBusName: "test-bus",
			sqsClient: new SQSClient({ region: "us-east-1" }),
			generateSummaryQueueUrl: "https://sqs.example/queue",
		});

		expect(typeof bundle.publishEvent).toBe("function");
		expect(typeof bundle.dispatchGenerateSummary).toBe("function");
	});
});

describe("initDispatchComprehensiveCrawl", () => {
	it("forwards url + userId through publishEvent with the ComprehensiveCrawlCommand wire shape", async () => {
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const dispatch = initDispatchComprehensiveCrawl({ publishEvent });
		await dispatch({ url: "https://example.com/doc.pdf", userId: "user-1" });

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", userId: "user-1" }),
		});
	});

	it("sets recrawl=true on the dispatched payload so the comprehensive Lambda emits RecrawlContentExtractedEvent for admin recrawls", async () => {
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const dispatch = initDispatchComprehensiveCrawl({ publishEvent, recrawl: true });
		await dispatch({ url: "https://example.com/doc.pdf" });

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "ComprehensiveCrawlCommand",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", recrawl: true }),
		});
	});
});
