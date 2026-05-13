import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { initEventsDepBundle } from "./events";

describe("initEventsDepBundle", () => {
	it("returns a bundle with publishEvent, dispatchGenerateSummary, and dispatchSubmitLink fields", () => {
		const bundle = initEventsDepBundle({
			eventBridgeClient: new EventBridgeClient({ region: "us-east-1" }),
			eventBusName: "test-bus",
			sqsClient: new SQSClient({ region: "us-east-1" }),
			generateSummaryQueueUrl: "https://sqs.example/queue",
			submitLinkQueueUrl: "https://sqs.example/submit-link",
		});

		expect(typeof bundle.publishEvent).toBe("function");
		expect(typeof bundle.dispatchGenerateSummary).toBe("function");
		expect(typeof bundle.dispatchSubmitLink).toBe("function");
	});
});
