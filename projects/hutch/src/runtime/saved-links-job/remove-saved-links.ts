import assert from "node:assert";
import {
	addSavedLinksJobCount,
	type SavedLinksJobCounts,
	type SavedLinksJobId,
	selectRemovalPage,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { LinkDequeuedEvent } from "@packages/infra-components";
import type {
	FindOriginalUrls,
	ForEachHeldLinkPage,
	ForEachRemovalCandidatePage,
	ListReadlistDefinitions,
	MoveNewsletterLinkToHold,
} from "@packages/provider-contracts/article-store";
import type { ListAllUserHighlights } from "@packages/provider-contracts/highlights";
import { chunksOf, type RunSavedLinksJobAction, SAVED_LINKS_JOB_CHUNK_SIZE } from "./saved-links-job.types";

export function initRemoveSavedLinks(deps: {
	forEachRemovalCandidatePage: ForEachRemovalCandidatePage;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	listReadlistDefinitions: ListReadlistDefinitions;
	listAllUserHighlights: ListAllUserHighlights;
	moveNewsletterLinkToHold: MoveNewsletterLinkToHold;
	findOriginalUrls: FindOriginalUrls;
	publishEvent: PublishEvent;
	now: () => Date;
}): RunSavedLinksJobAction {
	return async ({ userId, jobId, detail, counts: seeded, resumed, recordProgress }) => {
		const job = detail.job;
		assert(job.action === "remove", "the remove runner takes a remove job");
		const cutoff = new Date(job.cutoff);
		const readlists = (await deps.listReadlistDefinitions(userId)).map((definition) => definition.slug);
		let counts: SavedLinksJobCounts = resumed ? await heldEarlier({ userId, jobId, counts: seeded }) : seeded;
		let stale = false;
		await deps.forEachRemovalCandidatePage({
			userId,
			onPage: async (candidates) => {
				if (stale) return;
				const highlights = await deps.listAllUserHighlights(userId);
				const page = selectRemovalPage({
					candidates,
					userId,
					highlighted: new Set(highlights.map((highlight) => highlight.highlightOf)),
					cutoff,
					senders: job.senders,
					counts,
				});
				counts = page.counts;
				for (const chunk of chunksOf({ items: page.selected, size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
					if (stale) return;
					const moves = await Promise.all(
						chunk.map(async (storedKey) => ({
							storedKey,
							move: await deps.moveNewsletterLinkToHold({
								userId,
								jobId,
								storedKey,
								cutoff,
								senders: job.senders,
								readlists,
								now: deps.now(),
							}),
						})),
					);
					const held: string[] = [];
					for (const { storedKey, move } of moves) {
						if (move.outcome === "held") held.push(storedKey);
						if (move.outcome === "skipped") counts = addSavedLinksJobCount({ counts, code: move.reason, by: 1 });
					}
					counts = addSavedLinksJobCount({ counts, code: "held", by: held.length });
					await publishDequeued({ userId, storedKeys: held });
					stale = (await recordProgress(counts)).outcome === "stale";
				}
			},
		});
		if (stale) return { outcome: "stale" };
		return { outcome: "finished", counts };
	};

	async function heldEarlier(params: { userId: UserId; jobId: SavedLinksJobId; counts: SavedLinksJobCounts }) {
		const storedKeys = new Set<string>();
		await deps.forEachHeldLinkPage({
			userId: params.userId,
			now: deps.now(),
			onPage: async (links) => {
				for (const link of links) if (link.jobId === params.jobId) storedKeys.add(link.storedKey);
			},
		});
		for (const chunk of chunksOf({ items: [...storedKeys], size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
			await publishDequeued({ userId: params.userId, storedKeys: chunk });
		}
		return { ...params.counts, held: storedKeys.size };
	}

	async function publishDequeued(params: { userId: UserId; storedKeys: string[] }) {
		if (params.storedKeys.length === 0) return;
		const originals = await deps.findOriginalUrls({ storedKeys: params.storedKeys });
		for (const storedKey of params.storedKeys) {
			const url = originals.get(storedKey);
			assert(url, "a held link's article row carries its original URL");
			await deps.publishEvent(LinkDequeuedEvent, { url, userId: params.userId });
		}
	}
}
