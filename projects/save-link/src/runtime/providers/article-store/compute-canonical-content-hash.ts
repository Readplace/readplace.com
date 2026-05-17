import { createHash } from "node:crypto";
import { stripHtml } from "../../domain/generate-summary/strip-html";

/**
 * Hash the readable text of canonical HTML. Hashing the stripped text rather
 * than raw HTML means rotating ads/tracking scripts on the origin do not flip
 * the hash, so a re-crawl of the same article does not trigger a summary
 * regeneration. The stripping logic mirrors what the summariser feeds to
 * DeepSeek (`generate-summary.main.ts`'s `cleanContent: stripHtml`) so the
 * hash space lines up with the input the summary was actually generated from.
 */
export function computeCanonicalContentHash(canonicalHtml: string): string {
	const text = stripHtml(canonicalHtml);
	return createHash("sha256").update(text, "utf8").digest("hex");
}
