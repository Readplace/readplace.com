import type { CrawlUnsupportedReason } from "@packages/article-state-types";

const TIER_1_DISPOSITION = {
	"non-html-content": "defer",
	paywall: "defer",
	"javascript-required": "defer",
	"content-too-large": "terminal",
} satisfies Record<CrawlUnsupportedReason["kind"], "defer" | "terminal">;

export function terminalUnsupportedReason(
	reason: CrawlUnsupportedReason | undefined,
): CrawlUnsupportedReason | undefined {
	if (reason === undefined) return undefined;
	return TIER_1_DISPOSITION[reason.kind] === "terminal" ? reason : undefined;
}
