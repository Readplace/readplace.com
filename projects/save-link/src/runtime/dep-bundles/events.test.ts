import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { initEventsDepBundle } from "./events";

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
