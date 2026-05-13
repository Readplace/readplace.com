import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initEventsDepBundle } from "./events";
import { initArticleAggregateDepBundle } from "./article-aggregate";

describe("initArticleAggregateDepBundle", () => {
	it("returns a bundle with store, dispatchEffect, and transitionAndPersist fields", () => {
		const events = initEventsDepBundle({
			eventBridgeClient: new EventBridgeClient({ region: "us-east-1" }),
			eventBusName: "test-bus",
			sqsClient: new SQSClient({ region: "us-east-1" }),
			generateSummaryQueueUrl: "https://sqs.example/queue",
		});

		const bundle = initArticleAggregateDepBundle({
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			articlesTable: "articles-table",
			events,
		});

		expect(typeof bundle.store).toBe("object");
		expect(typeof bundle.dispatchEffect).toBe("function");
		expect(typeof bundle.transitionAndPersist).toBe("function");
	});
});
