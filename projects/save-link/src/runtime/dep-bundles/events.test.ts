import { UserIdSchema } from "@packages/domain/user";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";
import { SimpleCrawlUnsupportedEvent } from "@packages/infra-components";
import {
	initEmitSimpleCrawlUnsupported,
	initEventsDepBundle,
} from "./events";

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

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
		const { publishEvent, published } = initRecordingPublishEvent();

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example.com/doc.pdf", unsupportedReason: undefined, saveAttemptId, userId: UserIdSchema.parse("user-1"), trigger: "save" });

		expect(published).toContainEqual({ detailType: SimpleCrawlUnsupportedEvent.detailType, detail: {
			url: "https://example.com/doc.pdf",
			saveAttemptId,
			userId: "user-1",
			trigger: "save",
		} });
	});

	it("threads the recrawl trigger through the event so the policy → comprehensive chain preserves admin recrawl semantics", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example.com/doc.pdf", unsupportedReason: undefined, saveAttemptId, trigger: "recrawl" });

		expect(published).toContainEqual({ detailType: SimpleCrawlUnsupportedEvent.detailType, detail: {
			url: "https://example.com/doc.pdf",
			saveAttemptId,
			userId: undefined,
			trigger: "recrawl",
		} });
	});

	it("threads the refresh trigger through the event so the policy → comprehensive chain emits RefreshContentExtractedEvent", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example.com/doc.pdf", unsupportedReason: undefined, saveAttemptId, trigger: "refresh" });

		expect(published).toContainEqual({ detailType: SimpleCrawlUnsupportedEvent.detailType, detail: {
			url: "https://example.com/doc.pdf",
			saveAttemptId,
			userId: undefined,
			trigger: "refresh",
		} });
	});

	it("threads the unsupported reason through the event so the policy routes a javascript-required deferral to the render crawl", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://example-spa.test/post", unsupportedReason: "javascript-required", saveAttemptId, trigger: "save" });

		expect(published).toContainEqual({ detailType: SimpleCrawlUnsupportedEvent.detailType, detail: {
			url: "https://example-spa.test/post",
			unsupportedReason: "javascript-required",
			saveAttemptId,
			trigger: "save",
		} });
	});

	it("carries the page the free crawl reached so the render crawl can start there", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		const emit = initEmitSimpleCrawlUnsupported({ publishEvent });
		await emit({ url: "https://links.tracker.example/r/abc", unsupportedReason: "blocked", saveAttemptId, trigger: "save", finalUrl: "https://publisher.example/story" });

		expect(published).toContainEqual({ detailType: SimpleCrawlUnsupportedEvent.detailType, detail: {
			url: "https://links.tracker.example/r/abc",
			unsupportedReason: "blocked",
			saveAttemptId,
			trigger: "save",
			finalUrl: "https://publisher.example/story",
		} });
	});
});
