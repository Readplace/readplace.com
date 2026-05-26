import { consoleLogger } from "@packages/hutch-logger";
import OpenAI from "openai";
import { initPdfDocumentDiffReviewHandler } from "./domain/pdf-document-diff-review/pdf-document-diff-review-handler";
import { initReviewDocumentWithDeepseek } from "./domain/pdf-document-diff-review/init-review-document-with-deepseek";
import { OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS } from "./domain/pdf-document-diff-review/timeouts";
import { requireEnv } from "../require-env";

const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");

const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.deepseekMs,
});

const reviewDocumentWithLlm = initReviewDocumentWithDeepseek({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

export const handler = initPdfDocumentDiffReviewHandler({
	reviewDocumentWithLlm,
	logger: consoleLogger,
});
