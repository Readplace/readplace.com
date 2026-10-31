import { type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { initPdfDocumentDiffReviewHandler } from "./domain/pdf-document-diff-review/pdf-document-diff-review-handler";
import { initReviewDocumentWithDeepseek } from "./domain/pdf-document-diff-review/init-review-document-with-deepseek";
import { OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS } from "./domain/pdf-document-diff-review/timeouts";
import { requireEnv } from "@packages/require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.deepseekMs,
	maxRetries: 2,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const reviewDocumentWithLlm = initReviewDocumentWithDeepseek({
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
});

export const handler = initPdfDocumentDiffReviewHandler({
	reviewDocumentWithLlm,
	logger: consoleLogger,
});
