import { type HeldLink, summariseHeldLinks } from "@packages/domain/article";
import type {
	CountNewsletterIssues,
	FindKeysInAll,
	FindUnrestorableArticles,
	ForEachHeldLinkPage,
	RecordCountedNewsletterLinks,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import type { UserId } from "@packages/domain/user";
import type { RunSavedLinksJobAction } from "./saved-links-job.types";

export function initCountSavedLinks(deps: {
	summariseNewsletterLinks: SummariseNewsletterLinks;
	countNewsletterIssues: CountNewsletterIssues;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	findUnrestorableArticles: FindUnrestorableArticles;
	findKeysInAll: FindKeysInAll;
	recordCountedNewsletterLinks: RecordCountedNewsletterLinks;
	now: () => Date;
}): RunSavedLinksJobAction {
	return async ({ userId, jobId, detail }) => {
		const cutoff = new Date(detail.requestedAt);
		const [summary, issues, held] = await Promise.all([
			deps.summariseNewsletterLinks({ userId, cutoff }),
			deps.countNewsletterIssues({ userId }),
			countHeldLinks({ userId, cutoff }),
		]);
		const recorded = await deps.recordCountedNewsletterLinks({ userId, jobId, counted: { cutoff, summary, issues, held } });
		return recorded.outcome === "stale" ? recorded : { outcome: "finished", counts: {} };
	};

	async function countHeldLinks(params: { userId: UserId; cutoff: Date }) {
		const now = deps.now();
		const links: HeldLink[] = [];
		await deps.forEachHeldLinkPage({
			userId: params.userId,
			now,
			onPage: async (page) => {
				links.push(...page);
			},
		});
		const storedKeys = [...new Set(links.map((link) => link.storedKey))];
		const [unrestorable, inAll] = await Promise.all([
			deps.findUnrestorableArticles({ storedKeys }),
			deps.findKeysInAll({ userId: params.userId, storedKeys }),
		]);
		return summariseHeldLinks({ links, cutoff: params.cutoff, now, unrestorable, inAll });
	}
}
