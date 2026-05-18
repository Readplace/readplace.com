import { SQSClient } from "@aws-sdk/client-sqs";
import {
	EventBridgeClient,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import {
	initEmitSimpleCrawlUnsupported,
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

describe("initEmitSimpleCrawlUnsupported", () => {
	it("publishes SimpleCrawlUnsupportedEvent with url + userId through publishEvent", async () => {
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example.com/doc.pdf", userId: "user-1" });

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "SimpleCrawlUnsupported",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", userId: "user-1" }),
		});
	});

	it("threads recrawl=true through the event so the policy → comprehensive chain preserves admin recrawl semantics", async () => {
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example.com/doc.pdf", recrawl: true });

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "SimpleCrawlUnsupported",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", recrawl: true }),
		});
	});
});
