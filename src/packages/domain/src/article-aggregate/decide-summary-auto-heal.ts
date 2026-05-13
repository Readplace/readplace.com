import type { Article } from "./article.types";
import {
	SUMMARY_AUTO_HEAL_MAX_ATTEMPTS,
	SUMMARY_AUTO_HEAL_TTL_MS,
} from "./auto-heal-constants";

export type SummaryAutoHealDecision = "reprime" | "skip";

/**
 * Decide whether the stale-check should re-prime a `summary.failed` row.
 *
 * - Not failed: skip (only auto-heal failed rows).
 * - Failed, under the attempt budget: reprime.
 * - Failed, budget exhausted, no recorded last attempt: skip (shouldn't happen,
 *   but failing closed beats infinite retry).
 * - Failed, budget exhausted, last attempt within TTL: skip (back off until
 *   the model-side outage has had time to resolve).
 * - Failed, budget exhausted, last attempt older than TTL: reprime (the row
 *   gets a fresh budget on the next round).
 */
export function decideSummaryAutoHeal(
	article: Article,
	now: Date,
): SummaryAutoHealDecision {
	if (article.summary.kind !== "failed") return "skip";
	if (article.summaryAutoHeal.attempts < SUMMARY_AUTO_HEAL_MAX_ATTEMPTS) {
		return "reprime";
	}
	const last = article.summaryAutoHeal.lastAttemptAt;
	if (!last) return "skip";
	const ageMs = now.getTime() - new Date(last).getTime();
	return ageMs >= SUMMARY_AUTO_HEAL_TTL_MS ? "reprime" : "skip";
}
