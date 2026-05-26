import { consoleLogger } from "@packages/hutch-logger";
import OpenAI from "openai";
import { initConvertPageToHtmlWithDeepseek } from "./domain/pdf-page-html-convert/init-convert-page-to-html-with-deepseek";
import { initPdfPageHtmlConvertHandler } from "./domain/pdf-page-html-convert/pdf-page-html-convert-handler";
import { OCR_HTML_CONVERT_TIMEOUTS } from "./domain/pdf-page-html-convert/timeouts";
import { requireEnv } from "../require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: OCR_HTML_CONVERT_TIMEOUTS.deepseekMs,
});

const convertPageToHtmlWithLlm = initConvertPageToHtmlWithDeepseek({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

export const handler = initPdfPageHtmlConvertHandler({
	convertPageToHtmlWithLlm,
	logger: consoleLogger,
});
