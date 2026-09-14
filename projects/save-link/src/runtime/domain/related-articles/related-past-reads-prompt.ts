import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "./related-articles-limits";

/** The stricter, past-reads-only system prompt. Loaded and substituted once at
 * module load, exactly like the Next-read prompt, so the Lambda bundles the
 * `.md` beside the compiled handler and the same 0-3 / 120-char caps apply. */
export const PAST_READS_PROMPT = readFileSync(
	join(__dirname, "related-past-reads-prompt.md"),
	"utf-8",
)
	.replace("{{RELATED_RESULTS_MAX}}", String(RELATED_RESULTS_MAX))
	.replace("{{RELATED_REASON_MAX_CHARS}}", String(RELATED_REASON_MAX_CHARS));
