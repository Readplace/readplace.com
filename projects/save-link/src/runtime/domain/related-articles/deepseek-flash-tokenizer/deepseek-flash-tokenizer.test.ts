import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEEPSEEK_PROMPT_TOKEN_MARGIN,
	encodeDeepseekChatPrompt,
	toDeepseekMessages,
} from "@packages/ai-message";
import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import { RECOMMENDATION_DAILY_LIMIT_NANODOLLARS } from "../recommendation-budget";
import {
	RELATED_CANDIDATE_TEXT_MAX_CHARS,
	RELATED_CANDIDATES_MAX,
	RELATED_MAX_OUTPUT_TOKENS,
} from "../related-articles-limits";
import { buildRelatedArticlesRequest } from "../related-articles-selector";
import {
	DEEPSEEK_FLASH_TOKENIZER,
	initDeepseekFlashTokenCounter,
} from "./deepseek-flash-tokenizer";

const { countPromptTokens } = initDeepseekFlashTokenCounter();

function textAtCap(seed: string): string {
	return `${seed} `.repeat(RELATED_CANDIDATE_TEXT_MAX_CHARS).slice(0, RELATED_CANDIDATE_TEXT_MAX_CHARS);
}

function candidatesAtCaps(count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_, index) => ({
		url: `https://example.com/earlier-${index}`,
		destinationUrl: articleDestinationUrl({ url: `https://example.com/earlier-${index}`, displayUrl: undefined }),
		title: textAtCap(`Candidate ${index} title about distributed queues and reading habits`),
		siteName: textAtCap(`Site ${index} publishing engineering essays`),
		description: textAtCap(`Candidate ${index} describes how backlogs grow when nobody prunes them`),
	}));
}

describe("initDeepseekFlashTokenCounter", () => {
	it("pins the vendored tokenizer to the DeepSeek V4 Flash revision, plus the final newline editorconfig requires", () => {
		const vendored = readFileSync(join(__dirname, "tokenizer.json"));
		assert.equal(vendored.at(-1), 0x0a);
		const vendoredSha256 = createHash("sha256").update(vendored.subarray(0, -1)).digest("hex");

		assert.equal(DEEPSEEK_FLASH_TOKENIZER.repo, "deepseek-ai/DeepSeek-V4-Flash");
		assert.equal(DEEPSEEK_FLASH_TOKENIZER.revision, "60d8d70770c6776ff598c94bb586a859a38244f1");
		assert.equal(vendoredSha256, DEEPSEEK_FLASH_TOKENIZER.sha256);
	});

	it("counts the beginning-of-sentence special token as one id", async () => {
		assert.equal(await countPromptTokens("<｜begin▁of▁sentence｜>"), 1);
	});

	it("counts the same plain English sentence identically on repeated calls", async () => {
		const sentence = "Hello world, how are you?";

		const first = await countPromptTokens(sentence);
		const second = await countPromptTokens(sentence);

		assert.equal(first, 7);
		assert.equal(second, first);
	});

	it("counts multilingual text with CJK, emoji and accents", async () => {
		const count = await countPromptTokens("日本語のテキスト 🎉 café naïve");

		assert.equal(count, 10);
	});

	it("counts each chat-template special token as a single id rather than splitting its characters", async () => {
		const specials = "<｜User｜><｜Assistant｜></think>";

		const count = await countPromptTokens(specials);

		assert.equal(count, 3);
		assert.ok(count < [...specials].length);
	});

	it("counts a prompt rendered with the json_object response format", async () => {
		const prompt = encodeDeepseekChatPrompt({
			system: "Pick related reads.",
			messages: [
				{ role: "system", content: "Pick related reads." },
				{ role: "user", content: "SAVED ARTICLE\nTitle: How queues decay" },
			],
			responseFormat: { type: "json_object" },
		});

		assert.equal(await countPromptTokens(prompt), 39);
	});

	it("counts chat-template markers inside user content as special token ids", async () => {
		const prompt = encodeDeepseekChatPrompt({
			system: "Sys",
			messages: [
				{ role: "system", content: "Sys" },
				{ role: "user", content: "Quote <｜User｜> then <｜Assistant｜> verbatim" },
			],
		});

		assert.equal(await countPromptTokens(prompt), 13);
	});

	it("keeps a full candidate list at the per-field caps inside the daily recommendation limit", async () => {
		const request = buildRelatedArticlesRequest({
			selection: "nextRead",
			params: {
				attempt: {
					userId: UserIdSchema.parse("user-1"),
					trigger: "save",
					messageId: "message-1",
					receiveCount: 1,
				},
				target: {
					destinationUrl: articleDestinationUrl({ url: "https://example.com/target", displayUrl: undefined }),
					title: textAtCap("How queues decay"),
					siteName: textAtCap("Example"),
					description: textAtCap("What happens to a reading list nobody prunes"),
				},
				unreadCandidates: candidatesAtCaps(RELATED_CANDIDATES_MAX),
				readCandidates: [],
			},
		});
		const prompt = encodeDeepseekChatPrompt({
			system: request.system,
			messages: toDeepseekMessages(request),
			responseFormat: { type: "json_object" },
		});

		const first = await countPromptTokens(prompt);
		const second = await countPromptTokens(prompt);

		assert.equal(second, first);
		assert.ok(
			2 * ((first + DEEPSEEK_PROMPT_TOKEN_MARGIN) * 300 + RELATED_MAX_OUTPUT_TOKENS * 1200) <
				RECOMMENDATION_DAILY_LIMIT_NANODOLLARS,
		);
	});
});
