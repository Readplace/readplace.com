import type { ArticleCrawl } from "../article-crawl/article-crawl.types";

/**
 * The stale-check has three possible decisions when a row exists. Encoded as
 * a typed action so a new ArticleCrawl variant breaks the build here — the
 * single owner of "should the stale-check reprime this row?". Operator-only
 * recovery (via /admin/recrawl) is encoded as "skip" on terminal states.
 */
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
