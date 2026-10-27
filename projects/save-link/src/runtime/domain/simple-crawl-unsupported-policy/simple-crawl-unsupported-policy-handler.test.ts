import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initCrawlArticle, type CrawlArticleResult, type CrawlFetch, type ExtractPdf } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { initArticleSiteRules } from "@packages/article-parser";
import { noopLogger } from "@packages/hutch-logger";
import { ComprehensiveCrawlCommand } from "@packages/hutch-infra-components";
import { initSimpleCrawlUnsupportedPolicyHandler } from "./simple-crawl-unsupported-policy-handler";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: {
	url: string;
	userId?: string;
	recrawl?: boolean;
	refresh?: boolean;
	previousBodyHash?: string;
}): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { ...detail, saveAttemptId: "attempt-1" } }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initSimpleCrawlUnsupportedPolicyHandler", () => {
	it("dispatches ComprehensiveCrawlCommand with url and userId from the SimpleCrawlUnsupportedEvent", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			saveAttemptId: "attempt-1",
			userId: "user-1",
			recrawl: undefined,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("dispatches ComprehensiveCrawlCommand with recrawl=true when the event carries the recrawl flag", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", recrawl: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			saveAttemptId: "attempt-1",
			userId: undefined,
			recrawl: true,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("dispatches ComprehensiveCrawlCommand with refresh=true when the event carries the refresh flag (stale-check chain)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", refresh: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			saveAttemptId: "attempt-1",
			userId: undefined,
			recrawl: undefined,
			refresh: true,
			previousBodyHash: undefined,
		});
	});

	it("forwards previousBodyHash so the downstream comprehensive Lambda can fire the byte-gate on PDF re-fetch", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({
				url: "https://example.com/doc.pdf",
				refresh: true,
				previousBodyHash: "h".repeat(64),
			}),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/doc.pdf",
			saveAttemptId: "attempt-1",
			userId: undefined,
			recrawl: undefined,
			refresh: true,
			previousBodyHash: "h".repeat(64),
		});
	});

	it("dispatches ComprehensiveCrawlCommand without userId for anonymous saves", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/blob" }),
			buildLambdaContext(),
			() => {},
		);

		expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, {
			url: "https://example.com/blob",
			saveAttemptId: "attempt-1",
			userId: undefined,
			recrawl: undefined,
			refresh: undefined,
			previousBodyHash: undefined,
		});
	});

	it("reports the record as a batch failure when publishEvent throws (so SQS retries)", async () => {
		const publishEvent = jest.fn().mockRejectedValue(new Error("EventBridge throttled"));

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initSimpleCrawlUnsupportedPolicyHandler({
			publishEvent,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:simple-crawl-unsupported-policy",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(publishEvent).not.toHaveBeenCalled();
	});
});


describe("GitHub PDF viewer simple-to-comprehensive routing", () => {
	it.each([false, true])("extracts the declared PDF after simple deferral (recrawl=%s)", async (recrawl) => {
		const url = "https://github.com/sample/docs/blob/release%2Fnext/guides/paper.pdf?plain=1#page=2";
		const rawUrl = "https://github.com/sample/docs/raw/refs/heads/release/next/guides/paper.pdf";
		const pdf = Buffer.from("%PDF-1.4\nSynthetic PDF bytes for the injected extractor.");
		const html = "<html><head><title>Research handbook</title></head><body><p>The complete document body.</p></body></html>";
		const requests: string[] = [];
		const crawlFetch: CrawlFetch = async (requestedUrl) => {
			requests.push(requestedUrl);
			const response = requestedUrl === rawUrl
				? new Response(pdf, { headers: { "content-type": "application/pdf" } })
				: new Response(`<html><body>Loading document…<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
					payload: { codeViewBlobLayoutRoute: {
						path: "guides/paper.pdf",
						refInfo: { name: "release/next", currentOid: "a".repeat(40), refType: "branch" },
						blob: { rawBlobUrl: rawUrl },
					} },
				})}</script></body></html>`, { headers: { "content-type": "text/html" } });
			Object.defineProperty(response, "url", { value: requestedUrl });
			return response;
		};
		const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
		const shared = { crawlFetch, siteRules, logError: () => {}, logInfo: () => {} };
		const simple = initCrawlArticle(shared);
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>(async () => ({ kind: "fetched", title: "Research handbook", html }));
		const comprehensive = initCrawlArticle({ ...shared, extractPdf });
		const extracted: CrawlArticleResult[] = [];
		const publishEvent: PublishEvent = async (_event, detail) => {
			const command = ComprehensiveCrawlCommand.detailSchema.parse(detail);
			extracted.push(await comprehensive({ url: command.url }));
		};
		const dispatch = jest.fn(publishEvent);
		const policy = initSimpleCrawlUnsupportedPolicyHandler({ publishEvent: dispatch, logger: noopLogger });

		expect(await simple({ url })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
		await policy(createSqsEvent({ url, recrawl }), buildLambdaContext(), () => {});

		expect(dispatch).toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.objectContaining({ url, recrawl, saveAttemptId: "attempt-1" }));
		expect(extractPdf).toHaveBeenCalledWith({ buffer: pdf, url: rawUrl, onProgress: undefined });
		const [result] = extracted;
		assert(result?.status === "fetched");
		expect(result.html).toBe(html);
		expect(result.finalUrl).toBe(rawUrl);
		expect(result.bodyHash).toBe(createHash("sha256").update(pdf).digest("hex"));
		expect(requests).toEqual([url, rawUrl, url, rawUrl]);
	});
});
