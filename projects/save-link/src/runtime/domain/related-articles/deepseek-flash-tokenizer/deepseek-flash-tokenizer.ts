import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tokenizer } from "tokenizers";

export const DEEPSEEK_FLASH_TOKENIZER = {
	repo: "deepseek-ai/DeepSeek-V4-Flash",
	revision: "60d8d70770c6776ff598c94bb586a859a38244f1",
	sha256: "8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf",
} as const;

export type CountPromptTokens = (text: string) => Promise<number>;

export function initDeepseekFlashTokenCounter(): { countPromptTokens: CountPromptTokens } {
	let tokenizer: Tokenizer | undefined;
	const loadTokenizer = (): Tokenizer => {
		tokenizer ??= Tokenizer.fromString(readFileSync(join(__dirname, "tokenizer.json"), "utf-8"));
		return tokenizer;
	};
	const countPromptTokens: CountPromptTokens = async (text) => {
		const encoding = await loadTokenizer().encode(text, null, { addSpecialTokens: true });
		return encoding.getLength();
	};
	return { countPromptTokens };
}
