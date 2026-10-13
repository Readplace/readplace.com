import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";

type TerminalAction = "refresh-eligible" | "skip";

const TERMINAL_ACTIONS = {
	ready: "refresh-eligible",
	pending: "refresh-eligible",
	failed: "skip",
	unsupported: "skip",
} satisfies Record<ArticleCrawl["status"], TerminalAction>;

export function decideTerminalAction(
	crawl: ArticleCrawl | undefined,
): TerminalAction {
	if (!crawl) return "refresh-eligible";
	return TERMINAL_ACTIONS[crawl.status];
}
