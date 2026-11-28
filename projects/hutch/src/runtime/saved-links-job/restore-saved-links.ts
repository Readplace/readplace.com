import assert from "node:assert";
import {
	addSavedLinksJobCount,
	type HeldLink,
	heldLinkExpiresAt,
	isChosenSender,
	isNewsletterIssueKey,
	type NewsletterLinkRow,
	type SavedLinksJobCounts,
	selectHeldLinksToRestore,
} from "@packages/domain/article";
import type { InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { LinkQueuedEvent } from "@packages/infra-components";
import type {
	FindOriginalUrls,
	ForEachHeldLinkPage,
	ForEachRemovalCandidatePage,
	RestoreHeldLink,
} from "@packages/provider-contracts/article-store";
import { chunksOf, type RunSavedLinksJobAction, SAVED_LINKS_JOB_CHUNK_SIZE } from "./saved-links-job.types";

export function initRestoreSavedLinks(deps: {
	forEachHeldLinkPage: ForEachHeldLinkPage;
	forEachRemovalCandidatePage: ForEachRemovalCandidatePage;
	restoreHeldLink: RestoreHeldLink;
	findOriginalUrls: FindOriginalUrls;
	forEachRemovableEmailPage: InboxEmailStore["forEachRemovableEmailPage"];
	clearEmailRemoval: InboxEmailStore["clearEmailRemoval"];
	publishEvent: PublishEvent;
	now: () => Date;
}): RunSavedLinksJobAction {
	return async ({ userId, detail, counts: seeded, resumed, recordProgress }) => {
		const job = detail.job;
		assert(job.action === "restore", "the restore runner takes a restore job");
		const requestedAt = new Date(detail.requestedAt);
		const links: HeldLink[] = [];
		await deps.forEachHeldLinkPage({
			userId,
			now: deps.now(),
			onPage: async (page) => {
				links.push(...page);
			},
		});
		const chosen = selectHeldLinksToRestore({
			links,
			requestedAt,
			senders: job.senders,
			now: deps.now(),
		});
		let counts: SavedLinksJobCounts = resumed
			? await restoredEarlier({ userId, requestedAt, counts: seeded })
			: seeded;
		for (const chunk of chunksOf({ items: chosen, size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
			const restores = await Promise.all(
				chunk.map(async (link) => ({
					link,
					restore: await deps.restoreHeldLink({ userId, heldKey: link.heldKey, now: deps.now() }),
				})),
			);
			const restored: string[] = [];
			for (const { link, restore } of restores) {
				if (restore.outcome === "restored") restored.push(link.storedKey);
				if (isNewsletterIssueKey({ storedKey: link.storedKey, userId })) continue;
				if (restore.outcome !== "gone") counts = addSavedLinksJobCount({ counts, code: restore.outcome, by: 1 });
			}
			await publishQueued({ userId, storedKeys: restored });
			if ((await recordProgress(counts)).outcome === "stale") return { outcome: "stale" };
		}
		const now = deps.now();
		const marked: string[] = [];
		await deps.forEachRemovableEmailPage({
			userId,
			onPage: async (emails) => {
				for (const email of emails) {
					if (email.removal === undefined) continue;
					if (email.removal.removedAt.getTime() > requestedAt.getTime()) continue;
					if (heldLinkExpiresAt(email.removal.removedAt).getTime() <= now.getTime()) continue;
					if (!isChosenSender({ senders: job.senders, senderEmail: email.senderEmail })) continue;
					marked.push(email.receivedAtMessageId);
				}
			},
		});
		for (const chunk of chunksOf({ items: marked, size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
			await Promise.all(chunk.map((receivedAtMessageId) => deps.clearEmailRemoval({ userId, receivedAtMessageId })));
			counts = addSavedLinksJobCount({ counts, code: "restored-issue", by: chunk.length });
			if ((await recordProgress(counts)).outcome === "stale") return { outcome: "stale" };
		}
		return { outcome: "finished", counts };
	};

	async function restoredEarlier(params: {
		userId: UserId;
		requestedAt: Date;
		counts: SavedLinksJobCounts;
	}) {
		const storedKeys: string[] = [];
		await deps.forEachRemovalCandidatePage({
			userId: params.userId,
			onPage: async (candidates) => {
				for (const candidate of candidates) {
					if (candidate.kind === "row" && isRestoredSince({ row: candidate.row, requestedAt: params.requestedAt })) {
						storedKeys.push(candidate.row.storedKey);
					}
				}
			},
		});
		for (const chunk of chunksOf({ items: storedKeys, size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
			await publishQueued({ userId: params.userId, storedKeys: chunk });
		}
		return { ...params.counts, restored: storedKeys.length };
	}

	function isRestoredSince(params: { row: NewsletterLinkRow; requestedAt: Date }) {
		return params.row.restoredAt !== undefined && params.row.restoredAt.getTime() >= params.requestedAt.getTime();
	}

	async function publishQueued(params: { userId: UserId; storedKeys: string[] }) {
		if (params.storedKeys.length === 0) return;
		const originals = await deps.findOriginalUrls({ storedKeys: params.storedKeys });
		for (const storedKey of params.storedKeys) {
			const url = originals.get(storedKey);
			assert(url, "a restored link's article row carries its original URL");
			await deps.publishEvent(LinkQueuedEvent, { url, userId: params.userId });
		}
	}
}
