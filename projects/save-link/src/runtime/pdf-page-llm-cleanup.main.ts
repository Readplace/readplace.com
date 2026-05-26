import { consoleLogger } from "@packages/hutch-logger";
import OpenAI from "openai";
import { initCleanupPageWithDeepseek } from "./domain/pdf-page-llm-cleanup/init-cleanup-page-with-deepseek";
import { initPdfPageLlmCleanupHandler } from "./domain/pdf-page-llm-cleanup/pdf-page-llm-cleanup-handler";
import { OCR_LLM_CLEANUP_TIMEOUTS } from "./domain/pdf-page-llm-cleanup/timeouts";
import { requireEnv } from "../require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: OCR_LLM_CLEANUP_TIMEOUTS.deepseekMs,
});

const cleanupPageWithLlm = initCleanupPageWithDeepseek({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

export const handler = initPdfPageLlmCleanupHandler({
	cleanupPageWithLlm,
	logger: consoleLogger,
});
