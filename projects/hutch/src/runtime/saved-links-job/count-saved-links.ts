import { type HeldLink, summariseHeldLinks, summariseNewsletterIssues } from "@packages/domain/article";
import { emailIssueStoredKey, type InboxEmailStore } from "@packages/domain/inbox";
import type {
	FindKeysInAll,
	FindNewsletterIssueStates,
	FindUnrestorableArticles,
	ForEachHeldLinkPage,
	RecordCountedNewsletterLinks,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import type { UserId } from "@packages/domain/user";
import type { RunSavedLinksJobAction } from "./saved-links-job.types";

export function initCountSavedLinks(deps: {
	summariseNewsletterLinks: SummariseNewsletterLinks;
	findNewsletterIssueStates: FindNewsletterIssueStates;
	forEachRemovableEmailPage: InboxEmailStore["forEachRemovableEmailPage"];
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
			countIssues({ userId, cutoff }),
			countHeldLinks({ userId, cutoff }),
		]);
		const recorded = await deps.recordCountedNewsletterLinks({ userId, jobId, counted: { cutoff, summary, issues, held } });
		return recorded.outcome === "stale" ? recorded : { outcome: "finished", counts: {} };
	};

	async function countIssues(params: { userId: UserId; cutoff: Date }) {
		const states = await deps.findNewsletterIssueStates(params);
		const emails: Parameters<typeof summariseNewsletterIssues>[0]["emails"][number][] = [];
		await deps.forEachRemovableEmailPage({
			userId: params.userId,
			onPage: async (page) => {
				for (const email of page) {
					if (email.removal !== undefined) continue;
					const storedKey = emailIssueStoredKey({ userId: params.userId, receivedAtMessageId: email.receivedAtMessageId });
					emails.push({ senderEmail: email.senderEmail, receivedAt: email.receivedAt, issueState: states.get(storedKey) });
				}
			},
		});
		return summariseNewsletterIssues({ emails, cutoff: params.cutoff });
	}

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
		return summariseHeldLinks({ userId: params.userId, links, cutoff: params.cutoff, now, unrestorable, inAll });
	}
}
