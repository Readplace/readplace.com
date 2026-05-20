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
