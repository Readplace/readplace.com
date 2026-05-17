import assert from "node:assert";

/**
 * OpenAI-compatible vision request shape DeepInfra accepts for multimodal
 * models. Image inputs are base64 data URLs in `image_url` content blocks.
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
 * Per-batch output budget. Structured HTML output is verbose vs plain text
 * (tags + entities multiply tokens, especially for table-heavy pages where
 * row/cell markup compounds). 12,000 tokens gives ~4,000 per page in a
 * 3-page batch — enough headroom for dense academic prose with bibliography,
 * code blocks, and multi-column tables without truncation. The previous
 * 20,000-token cap let the dense-math middle pages of arXiv's Attention Is
 * All You Need consume the full budget at ~50 tok/s, running each batch
 * past 6 minutes and blowing the Lambda's 600s timeout.
 */
const MAX_BATCH_OUTPUT_TOKENS = 12000;

const OCR_INSTRUCTION = [
	"You are converting PDF pages into a semantically valid HTML5 fragment that represents the article as it would appear on a clean reader webpage.",
	"",
	"For each page image, infer document structure from visual cues:",
	"- Larger / bolder font runs at the top of a section -> <h1>, <h2>, <h3> (pick the level from relative size, not absolute size).",
	"- Body prose -> <p>. Merge soft line breaks inside a paragraph.",
	"- Bulleted or numbered items -> <ul>/<ol> with <li> children.",
	"- Monospace runs or visibly indented code -> <pre><code>...</code></pre>.",
	"- Quoted blocks (indented + smaller, or italicized) -> <blockquote>.",
	"- Tabular grids -> <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>.",
	"- Figures -> <figure><figcaption>{caption text}</figcaption></figure> (omit the <img> — we do not have figure assets).",
	"- Bold/italic inline runs -> <strong>/<em>.",
	"- Links visible in the PDF -> <a href=\"{url}\">{text}</a>.",
	"- Drop running headers, footers, and page numbers.",
	"- Drop watermarks, decorative ornaments, and standalone images that have no caption.",
	"",
	"Output rules:",
	"- Output ONLY the HTML5 fragment. No <html>, <head>, <body>, <article>, <!DOCTYPE>, no Markdown, no commentary.",
	"- Do not wrap the whole output in a single container — the caller will stitch fragments from multiple page batches together.",
	"- Preserve text verbatim. Do not summarize, translate, or paraphrase.",
	"- If a paragraph or list spans into the next page image, finish the element at the end of this batch rather than leaving an open tag.",
	"- Escape \"<\", \">\", \"&\", and quotes correctly inside text content.",
].join("\n");

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
