import type {
	CountNewsletterIssues,
	RecordCountedNewsletterLinks,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import type { RunSavedLinksJobAction } from "./saved-links-job.types";

export function initCountSavedLinks(deps: {
	summariseNewsletterLinks: SummariseNewsletterLinks;
	countNewsletterIssues: CountNewsletterIssues;
	recordCountedNewsletterLinks: RecordCountedNewsletterLinks;
}): RunSavedLinksJobAction {
	return async ({ userId, jobId, detail }) => {
		const cutoff = new Date(detail.requestedAt);
		const [summary, issues] = await Promise.all([
			deps.summariseNewsletterLinks({ userId, cutoff }),
			deps.countNewsletterIssues({ userId }),
		]);
		const recorded = await deps.recordCountedNewsletterLinks({ userId, jobId, counted: { cutoff, summary, issues } });
		return recorded.outcome === "stale" ? recorded : { outcome: "finished", counts: {} };
	};
}
