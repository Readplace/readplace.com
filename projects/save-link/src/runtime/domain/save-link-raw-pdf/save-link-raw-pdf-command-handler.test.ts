import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { candidateProvenance } from "@packages/tier-source";
import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/logger";
import { markCrawlAwaitingReader, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { TierContentExtractedEvent } from "@packages/infra-components";
import { initSaveLinkRawPdfCommandHandler } from "./save-link-raw-pdf-command-handler";
import { initProcessContentWithLocalMedia } from "../save-link/process-content-with-local-media";
import type { ParseHtml } from "@packages/article-parser";
import type { ExtractPdf } from "@packages/crawl-article";
import type { DownloadMedia } from "@packages/finalize-article";
import type { PutTierSource } from "@packages/tier-source";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: { url: string; userId: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { saveAttemptId: "attempt-1", sourceUrl: detail.url, sourceOriginalUrl: detail.url, ...detail } }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkRawPdfCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const noopDownloadMedia: DownloadMedia = async () => [];

const processContent = initProcessContentWithLocalMedia({
	rewriteHtmlUrls: (html, rewriteUrl) => {
		const plugin = urls({ eachURL: rewriteUrl });
		return posthtml().use(plugin).process(html).then((result) => result.html);
	},
});

const PDF_MAGIC_BYTES = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(16)]);

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: {
		title: "Test PDF",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		content: "<p>PDF content</p>",
	},
});

const successfulExtractPdf: ExtractPdf = async ({ url: _url }) => ({
	kind: "fetched",
	html: "<html><body><p>PDF content</p></body></html>",
	title: "Test PDF",
});

type HandlerDeps = Parameters<typeof initSaveLinkRawPdfCommandHandler>[0];

function createHandler({ onPublish, ...overrides }: Partial<HandlerDeps> & { onPublish?: () => void } = {}) {
	const recording = initRecordingPublishEvent();
	const deps: HandlerDeps = {
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		resolveOriginalUrl: async (url) => url,
		readPendingPdf: jest.fn().mockResolvedValue({ bytes: PDF_MAGIC_BYTES, capturedAt: "2026-10-01T00:00:00.000Z" }),
		extractPdf: successfulExtractPdf,
		chargeOcrPagesFor: () => async () => ({ allowed: true }),
		markOcrPagesHeld: jest.fn().mockResolvedValue(undefined),
		parseHtml: successfulParse,
		downloadMedia: noopDownloadMedia,
		processContent,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		publishEvent: async (event, detail) => {
			await recording.publishEvent(event, detail);
			onPublish?.();
		},
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		now: () => new Date("2026-04-18T12:00:00.000Z"),
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		}),
		...overrides,
	};
	return { handler: initSaveLinkRawPdfCommandHandler(deps), deps, published: recording.published };
}

describe("initSaveLinkRawPdfCommandHandler", () => {
	it("reads pending PDF bytes, extracts to HTML, writes a tier-0 source, and emits TierContentExtractedEvent carrying userId", async () => {
		const { handler, deps, published } = createHandler();

		await handler(
			createSqsEvent({ url: "https://example.com/x.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(deps.readPendingPdf).toHaveBeenCalledWith("https://example.com/x.pdf", { saveAttemptId: "attempt-1" });
		expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://example.com/x.pdf",
			tier: "tier-0",
			html: "<p>PDF content</p>",
			metadata: expect.objectContaining({
				title: "Test PDF",
				siteName: "example.com",
				excerpt: "test",
				wordCount: 10,
				estimatedReadTime: 1,
				imageUrl: undefined,
				authorUserId: "user-1",
			}),
		}));
		expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
			url: "https://example.com/x.pdf",
			userId: "user-1",
			extractedAt: "2026-04-18T12:00:00.000Z",
		}) });
	});

	it("extracts the PDF under the reader's account scope keyed by the sha256 of the uploaded bytes", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>(successfulExtractPdf);
		const { handler } = createHandler({ extractPdf });

		await handler(
			createSqsEvent({ url: "https://example.com/x.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		assert.equal(extractPdf.mock.calls.length, 1);
		assert.deepEqual(extractPdf.mock.calls[0][0].scope, {
			kind: "account",
			userId: "user-1",
			fileHash: createHash("sha256").update(PDF_MAGIC_BYTES).digest("hex"),
		});
	});

	it("writes the tier-0 source before publishing TierContentExtractedEvent", async () => {
		const calls: string[] = [];
		const publishEvent = jest.fn(async () => { calls.push("publishEvent"); });
		const putTierSource: PutTierSource = jest.fn(async (params: Parameters<PutTierSource>[0]) => { calls.push("putTierSource"); return params.metadata; });

		const { handler } = createHandler({ publishEvent, putTierSource });

		await handler(
			createSqsEvent({ url: "https://example.com/x.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(calls).toEqual(["putTierSource", "publishEvent"]);
	});

	it("flips crawl to unsupported (terminal) and skips tier-source write when extractPdf returns failed", async () => {
		const failingExtractPdf: ExtractPdf = async () => ({
			kind: "failed",
			reason: "ocr returned empty",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();

		const { handler } = createHandler({
			extractPdf: failingExtractPdf,
			transitionAndPersist,
			putTierSource,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
			url: "https://example.com/bad.pdf",
			input: {
				reason: {
					kind: "non-html-content",
					contentType: "pdf extraction failed: ocr returned empty",
				},
			},
		});
		expect(putTierSource).not.toHaveBeenCalled();
		expect(published).toEqual([]);
	});

	it("routes terminal parse errors through markCrawlFailed and reports the record as a batch failure so SQS redelivers it", async () => {
		const failingParse: ParseHtml = () => ({
			ok: false,
			reason: "Readability returned null",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const { handler } = createHandler({
			parseHtml: failingParse,
			transitionAndPersist,
			putTierSource,
			publishEvent,
			logger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad.pdf",
			input: {
				reason: { kind: "parse-error", detail: "Readability returned null" },
			},
		});
		expect(putTierSource).not.toHaveBeenCalled();
		expect(published).toEqual([]);
		expect(error).toHaveBeenCalledWith(
			"[SaveLinkRawPdfCommand] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message:
						"[SaveLinkRawPdfCommand] parse failed for https://example.com/bad.pdf: Readability returned null",
				}),
			}),
		);
	});
});

it("writes the tier-0 candidate, reads the snapshot, logs the outcome, announces it, then logs, with exactly these arguments", async () => {
	const trace: unknown[][] = [];
	const record = (level: string) => (...args: unknown[]) => {
		trace.push([level, ...args]);
	};
	const url = "https://example.com/x.pdf";
	const { handler } = createHandler({
		putTierSource: async (params) => {
			trace.push(["putTierSource", params]);
			return params.metadata;
		},
		readTierSnapshot: async (params) => {
			trace.push(["readTierSnapshot", params]);
			return { tier0Status: "success", tier1Status: "failed", pickedTier: "tier-0" };
		},
		logCrawlOutcome: (params) => {
			trace.push(["logCrawlOutcome", params]);
		},
		publishEvent: async (event, detail) => {
			trace.push(["publishEvent", event.detailType, detail]);
		},
		logger: { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") },
	});

	await handler(createSqsEvent({ url, userId: "user-1" }), buildLambdaContext(), () => {});

	const html = "<p>PDF content</p>";
	const metadata = candidateProvenance({ metadata: { title: "Test PDF", siteName: "example.com", excerpt: "test", wordCount: 10, estimatedReadTime: 1, imageUrl: undefined, authorUserId: "user-1" }, html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse("attempt-1"), originalUrl: url, sourceUrl: url, kind: "extension", fetchedAt: "2026-10-01T00:00:00.000Z" });
	assert.deepEqual(trace, [
		["putTierSource", { url, tier: "tier-0", html, metadata }],
		["readTierSnapshot", { url }],
		["logCrawlOutcome", { url, thisTier: "tier-0", thisTierStatus: "success", otherTierStatus: "failed", pickedTier: "tier-0" }],
		["publishEvent", TierContentExtractedEvent.detailType, { saveAttemptId: "attempt-1", candidates: [{ id: metadata.id, tier: "tier-0" }], url, userId: "user-1", extractedAt: "2026-04-18T12:00:00.000Z" }],
		["info", "[SaveLinkRawPdfCommand] tier-0 source written", { url, capturedTitle: undefined }],
	]);
});

describe("initSaveLinkRawPdfCommandHandler — OCR page allowance", () => {
	const url = "https://example.com/upload.pdf";
	const retryAt = new Date("2026-04-19T09:00:00.000Z");

	it("charges the uploader, keyed on the save attempt", async () => {
		const charges: { userId: string; claimId: string }[] = [];
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>(async (params) => {
			await params.chargeOcrPages({ pages: 2 });
			return { kind: "fetched", html: "<html><body><p>PDF content</p></body></html>", title: "Test PDF" };
		});
		const { handler } = createHandler({
			extractPdf,
			chargeOcrPagesFor: (params) => {
				charges.push(params);
				return async () => ({ allowed: true });
			},
		});

		await handler(createSqsEvent({ url, userId: "user-1" }), buildLambdaContext(), () => {});

		expect(charges).toEqual([{ userId: "user-1", claimId: "attempt-1" }]);
	});

	it("holds an over-quota upload on the uploader's row and leaves a row that holds committed content alone", async () => {
		const markOcrPagesHeld = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource = jest.fn().mockResolvedValue(undefined);
		const infos: { message: string; context: unknown }[] = [];
		const logger = { ...noopLogger, info: (message: unknown, context?: unknown) => { infos.push({ message: String(message), context }); } };
		const { handler, published } = createHandler({
			extractPdf: async () => ({ kind: "over-ocr-quota", pages: 40, pagesLeft: 12, retryAt }),
			markOcrPagesHeld,
			transitionAndPersist,
			putTierSource,
			logger,
			readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "success", pickedTier: "tier-1" }),
		});

		const result = await handler(createSqsEvent({ url, userId: "user-1" }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(markOcrPagesHeld).toHaveBeenCalledWith({ userId: "user-1", url, hold: { pages: 40, pagesLeft: 12, retryAt } });
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(published).toEqual([]);
		expect(infos).toContainEqual({
			message: "[SaveLinkRawPdfCommand] ocr_page_quota_held",
			context: { url, saveAttemptId: "attempt-1", pages: 40, pagesLeft: 12, retryAt: "2026-04-19T09:00:00.000Z" },
		});
	});

	it("ends an over-quota upload awaiting a reader when the article holds no committed content, so the row never sits pending", async () => {
		const markOcrPagesHeld = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const { handler, published } = createHandler({
			extractPdf: async () => ({ kind: "over-ocr-quota", pages: 40, pagesLeft: 12, retryAt }),
			markOcrPagesHeld,
			transitionAndPersist,
			readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		});

		const result = await handler(createSqsEvent({ url, userId: "user-1" }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(markOcrPagesHeld).toHaveBeenCalledWith({ userId: "user-1", url, hold: { pages: 40, pagesLeft: 12, retryAt } });
		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlAwaitingReader, { url, input: { deferredLeg: "comprehensive" } });
		expect(published).toEqual([]);
	});

	it("retries the record when the charge itself fails", async () => {
		const { handler } = createHandler({
			extractPdf: async (params) => {
				await params.chargeOcrPages({ pages: 2 });
				return { kind: "fetched", html: "<p>x</p>", title: "x" };
			},
			chargeOcrPagesFor: () => async () => { throw new Error("rate-limits table down"); },
		});

		const result = await handler(createSqsEvent({ url, userId: "user-1" }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
