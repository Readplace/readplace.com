import type { HutchLogger } from "@packages/hutch-logger";
import { condenseCandidateHtml } from "./condense-candidate-html";
import { DEEPSEEK_CONTEXT_TOKENS, DEEPSEEK_MAX_OUTPUT_TOKENS } from "./deepseek-limits";
import type { Tier } from "./tier.types";

export const SELECT_CONTENT_SYSTEM_PROMPT = [
	"Pick the more complete AND less chrome-laden article body for the given URL.",
	'"Most complete" means most actual article prose with the least gibberish.',
	"Strong signals: coherent prose, paragraphs/headings, the substantive body text.",
	'Anti-signals — penalise candidates carrying these: author byline/photo,',
	'"N min read", publish date next to byline, "Press enter or click to view image",',
	'"Get X\'s stories in your inbox", "Join Medium for free", "Remember me for faster',
	'sign in", any sign-up/subscribe interstitial, "verify you are human", "loading…",',
	"sitemap/navigation-only content, error pages, off-topic chrome.",
	"Prefer a slightly shorter body that drops the chrome over a longer body that keeps it.",
	'Reserve "tie" for candidates that are byte-identical or differ only in cosmetic',
	"whitespace; if one candidate carries even a single anti-signal the other lacks,",
	'commit to a winner — do NOT default to "tie" on long inputs. A "tie" verdict tells',
	"downstream code to keep whatever was canonical before, which silently locks in any",
	"stale chrome-laden content the cleaner candidate would have replaced.",
	'Reply with strict JSON only — no prose, no code fences: {"winner": "<label>" | "tie", "reason": "<short>"}.',
	"<label> must be one of the candidate labels A, B, C, ... shown in the user message.",
].join(" ");

export type SelectorCandidate = {
	tier: Tier;
	title: string;
	wordCount: number;
	html: string;
};

// HTML tokenises denser than prose (~2–3 chars/token vs prose's ~4). Filling a
// char budget of tokens×A with HTML that really tokenises at R chars/token
// costs tokens×(A/R), which stays within budget whenever A ≤ R — so picking the
// LOW end (A=2) keeps the derived char cap safely under the token limit for any
// Latin HTML (≥2 chars/token). CJK/other dense scripts can fall below 1
// char/token, so a very large non-Latin pair can still overflow; that degrades
// to select-content's 400 → "tie" net (canonical kept, no DLQ), never a failed
// crawl.
export const CHARS_PER_INPUT_TOKEN = 2;
const SAFETY = 0.85;
const SYSTEM_AND_FRAMING_RESERVE_CHARS = 8_000;
export const INPUT_TOKEN_BUDGET = DEEPSEEK_CONTEXT_TOKENS - DEEPSEEK_MAX_OUTPUT_TOKENS;
export const TOTAL_HTML_CHAR_BUDGET =
	Math.floor(INPUT_TOKEN_BUDGET * CHARS_PER_INPUT_TOKEN * SAFETY) - SYSTEM_AND_FRAMING_RESERVE_CHARS;

export function perCandidateHtmlCap(candidateCount: number): number {
	return Math.floor(TOTAL_HTML_CHAR_BUDGET / candidateCount);
}

/**
 * Candidates are presented to the model with letter labels A, B, C, … in input
 * order (mapped back to Tier by the caller). Letters keep the prompt short while
 * staying unambiguous regardless of how many tiers we contest in the future.
 */
export function buildSelectContentUserMessage(params: {
	url: string;
	candidates: readonly SelectorCandidate[];
	logger: HutchLogger;
}): string {
	const cap = perCandidateHtmlCap(params.candidates.length);
	const lines: string[] = [`URL: ${params.url}`, ""];
	params.candidates.forEach((candidate, index) => {
		const label = labelForIndex(index);
		const cleaned = condenseCandidateHtml(candidate.html);
		let body = cleaned;
		if (cleaned.length > cap) {
			params.logger.error(
				"[SelectContent] condensed candidate exceeds per-candidate budget; truncating, article signal lost",
				{ url: params.url, tier: candidate.tier, label, cleanedChars: cleaned.length, cap },
			);
			body = `${cleaned.slice(0, cap)}\n[truncated: showing the first ${cap} of ${cleaned.length} characters]`;
		}
		lines.push(
			`--- ${label} (tier=${candidate.tier}, title ${JSON.stringify(candidate.title)}, words ${candidate.wordCount}) ---`,
			body,
			"",
		);
	});
	return lines.join("\n");
}

export function labelForIndex(index: number): string {
	return String.fromCharCode("A".charCodeAt(0) + index);
}
