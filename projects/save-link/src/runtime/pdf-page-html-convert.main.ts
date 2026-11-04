import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { consoleLogger, Logger } from "@packages/logger";
import { initConvertPageToHtmlWithDeepseek } from "./domain/pdf-page-html-convert/init-convert-page-to-html-with-deepseek";
import { initPdfPageHtmlConvertHandler } from "./domain/pdf-page-html-convert/pdf-page-html-convert-handler";
import { OCR_HTML_CONVERT_TIMEOUTS } from "./domain/pdf-page-html-convert/timeouts";
import { readEnv } from "@packages/require-env";
import { PDF_PAGE_HTML_CONVERT_ENV } from "./pdf-page-html-convert.env";

const env = readEnv(PDF_PAGE_HTML_CONVERT_ENV);

const deepseekApiKey = env.DEEPSEEK_API_KEY;

const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: OCR_HTML_CONVERT_TIMEOUTS.deepseekMs,
	maxRetries: 2,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const convertPageToHtmlWithLlm = initConvertPageToHtmlWithDeepseek({
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
});

export const handler = initPdfPageHtmlConvertHandler({
	convertPageToHtmlWithLlm,
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
});
