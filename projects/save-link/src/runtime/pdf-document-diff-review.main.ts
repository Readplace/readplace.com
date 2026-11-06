import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, Logger } from "@packages/logger";
import { initPdfDocumentDiffReviewHandler } from "./domain/pdf-document-diff-review/pdf-document-diff-review-handler";
import { initReviewDocumentWithDeepseek } from "./domain/pdf-document-diff-review/init-review-document-with-deepseek";
import { OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS } from "./domain/pdf-document-diff-review/timeouts";
import { readEnv } from "@packages/require-env";
import { PDF_DOCUMENT_DIFF_REVIEW_ENV } from "./pdf-document-diff-review.env";

const env = readEnv(PDF_DOCUMENT_DIFF_REVIEW_ENV);

const deepseekApiKey = env.DEEPSEEK_API_KEY;

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.deepseekMs,
	maxRetries: 2,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const reviewDocumentWithLlm = initReviewDocumentWithDeepseek({
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
});

export const handler = initPdfDocumentDiffReviewHandler({
	reviewDocumentWithLlm,
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
});
