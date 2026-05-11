import assert from "node:assert";

/**
 * OpenAI-compatible vision request shape DeepInfra accepts for multimodal
 * models. Image inputs are base64 data URLs in `image_url` content blocks —
 * confirmed during the gemma-4-31B-it probe in this PR's planning phase.
 *
 * DeepInfra deprecated DeepSeek-OCR on 2026-05-07; the official deprecation
 * note points at google/gemma-4-31B-it as the replacement, which is what
 * we wire here.
 */
type VisionChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null } }>;
};

/**
 * Restricted to `role: "user"` so OpenAI's strict-discriminated message
 * unions accept the call. We never send `role: "system"` here — the OCR
 * instruction lives in the user message's text block alongside the page
 * images so the model treats it as part of the same turn.
 */
type VisionChatCompletion = (params: {
	model: string;
	max_tokens: number;
	messages: Array<{
		role: "user";
		content: Array<
			| { type: "text"; text: string }
			| { type: "image_url"; image_url: { url: string } }
		>;
	}>;
}) => Promise<VisionChatCompletionResponse>;

/**
 * The vision model picked by DeepInfra as the DeepSeek-OCR replacement
 * (see `replaced_by` field in DeepInfra's model metadata). $0.13/$0.38 per
 * 1M tokens at probe time; 262K context.
 */
const MODEL_ID = "google/gemma-4-31B-it";

/**
 * Per-batch output budget. The probe of a 13-page PDF returned ~6,914
 * completion tokens for the entire document. Capping each batch at 8,000
 * gives ~1,600 tokens of headroom per page in a 5-page batch — enough for
 * dense academic prose with bibliography while keeping the request bounded.
 */
const MAX_BATCH_OUTPUT_TOKENS = 8000;

const OCR_INSTRUCTION =
	"Extract all text from the following PDF page image(s) verbatim, in order. Preserve paragraph breaks. Output only the extracted text — no commentary, no summarization, no markdown formatting.";

export type CreateVisionMessage = (params: {
	images: ReadonlyArray<{ pngBuffer: Buffer }>;
}) => Promise<string>;

export function initCreateDeepInfraVisionMessage(deps: {
	createChatCompletion: VisionChatCompletion;
}): CreateVisionMessage {
	return async (params) => {
		assert(params.images.length > 0, "createVisionMessage requires at least one image");
		const content: Array<
			| { type: "text"; text: string }
			| { type: "image_url"; image_url: { url: string } }
		> = [{ type: "text", text: OCR_INSTRUCTION }];
		for (const image of params.images) {
			const dataUrl = `data:image/png;base64,${image.pngBuffer.toString("base64")}`;
			content.push({ type: "image_url", image_url: { url: dataUrl } });
		}
		const response = await deps.createChatCompletion({
			model: MODEL_ID,
			max_tokens: MAX_BATCH_OUTPUT_TOKENS,
			messages: [{ role: "user", content }],
		});
		const text = response.choices[0]?.message?.content?.trim();
		assert(text, "DeepInfra vision response missing message content");
		return text;
	};
}

export type { VisionChatCompletion };

export const DEEPINFRA_VISION_MODEL_ID = MODEL_ID;
export const DEEPINFRA_VISION_MAX_BATCH_OUTPUT_TOKENS = MAX_BATCH_OUTPUT_TOKENS;
