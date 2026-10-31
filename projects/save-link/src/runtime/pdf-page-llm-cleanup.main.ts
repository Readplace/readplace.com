import { type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { initCleanupPageWithDeepseek } from "./domain/pdf-page-llm-cleanup/init-cleanup-page-with-deepseek";
import { initPdfPageLlmCleanupHandler } from "./domain/pdf-page-llm-cleanup/pdf-page-llm-cleanup-handler";
import { OCR_LLM_CLEANUP_TIMEOUTS } from "./domain/pdf-page-llm-cleanup/timeouts";
import { requireEnv } from "@packages/require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: OCR_LLM_CLEANUP_TIMEOUTS.deepseekMs,
	maxRetries: 2,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const cleanupPageWithLlm = initCleanupPageWithDeepseek({
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
});

export const handler = initPdfPageLlmCleanupHandler({
	cleanupPageWithLlm,
	logger: consoleLogger,
});
