import { type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { initConvertPageToHtmlWithDeepseek } from "./domain/pdf-page-html-convert/init-convert-page-to-html-with-deepseek";
import { initPdfPageHtmlConvertHandler } from "./domain/pdf-page-html-convert/pdf-page-html-convert-handler";
import { OCR_HTML_CONVERT_TIMEOUTS } from "./domain/pdf-page-html-convert/timeouts";
import { requireEnv } from "@packages/require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: OCR_HTML_CONVERT_TIMEOUTS.deepseekMs,
	maxRetries: 2,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const convertPageToHtmlWithLlm = initConvertPageToHtmlWithDeepseek({
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
});

export const handler = initPdfPageHtmlConvertHandler({
	convertPageToHtmlWithLlm,
	logger: consoleLogger,
});
