import type { ReadlistFitEngine } from "./readlist-fit-engine";

export const READLIST_FIT_MAX_OUTPUT_TOKENS: Record<ReadlistFitEngine, number> = {
	"deepseek-flash": 8192,
	"deepseek-v4-pro-thinking": 32768,
};
export const MAX_PROMPT_URL_LENGTH = 300;
export const READLIST_FIT_REASON_MAX_CHARS = 120;
export const READLIST_FIT_EXAMPLES_MAX = 20;
