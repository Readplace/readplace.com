import type { Tier } from "./tier.types";

export const SELECT_CONTENT_SYSTEM_PROMPT = [
	"Pick the more complete article body for the given URL.",
	"Strong signals: coherent prose, paragraphs/headings, byline, dates.",
	'Anti-signals: "verify you are human", "loading…", sitemap/navigation-only',
	"content, boilerplate, off-topic chrome, error pages.",
	'Reply with strict JSON only — no prose, no code fences: {"winner": "<label>" | "tie", "reason": "<short>"}.',
	"<label> must be one of the candidate labels A, B, C, ... shown in the user message.",
].join(" ");

export type SelectorCandidate = {
	tier: Tier;
	title: string;
	wordCount: number;
	html: string;
};

/**
 * Candidates are presented to the model with letter labels A, B, C, … in input order
 * (mapped back to Tier by the caller). Letters keep the prompt short while staying
 * unambiguous regardless of how many tiers we contest in the future.
 */
export function buildSelectContentUserMessage(params: {
	url: string;
	candidates: readonly SelectorCandidate[];
}): string {
	const lines: string[] = [`URL: ${params.url}`, ""];
	params.candidates.forEach((candidate, index) => {
		const label = labelForIndex(index);
		lines.push(
			`--- ${label} (tier=${candidate.tier}, title ${JSON.stringify(candidate.title)}, words ${candidate.wordCount}) ---`,
			candidate.html,
			"",
		);
	});
	return lines.join("\n");
}

export function labelForIndex(index: number): string {
	return String.fromCharCode("A".charCodeAt(0) + index);
}
