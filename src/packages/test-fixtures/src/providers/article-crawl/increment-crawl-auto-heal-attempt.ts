import type {
	FindAutoHealState,
	IncrementCrawlAutoHealAttempt,
	WriteAutoHealAttempt,
} from "./article-crawl.types";

// Not atomic: concurrent calls may each slip one extra attempt through.
// Acceptable — the cap is a cost guard, not a correctness invariant.
export function initIncrementCrawlAutoHealAttempt(deps: {
	findAutoHealState: FindAutoHealState;
	writeAutoHealAttempt: WriteAutoHealAttempt;
}): { incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt } {
	const incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt = async ({
		url,
		nowIso,
		maxAttempts,
		ttlMs,
	}) => {
		const current = await deps.findAutoHealState(url);
		if (current) {
			const elapsed =
				new Date(nowIso).getTime() -
				new Date(current.lastAttemptAtIso).getTime();
			if (current.attempts >= maxAttempts && elapsed < ttlMs) {
				return "capped";
			}
		}
		await deps.writeAutoHealAttempt({
			url,
			attempts: (current?.attempts ?? 0) + 1,
			lastAttemptAtIso: nowIso,
		});
		return "reprimed";
	};

	return { incrementCrawlAutoHealAttempt };
}
