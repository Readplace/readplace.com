import assert from "node:assert";
import {
	addSavedLinksJobCount,
	isChosenSender,
	isNewsletterIssueKey,
	type SavedLinksJobCounts,
	type SavedLinksJobId,
	selectRemovalPage,
} from "@packages/domain/article";
import { emailIssueStoredKey, type InboxEmailStore, type RemovableInboxEmail } from "@packages/domain/inbox";
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
import type { ScheduleRemovedIssuesPurge } from "./schedule-removed-issues-purge";
import { chunksOf, type RunSavedLinksJobAction, SAVED_LINKS_JOB_CHUNK_SIZE } from "./saved-links-job.types";

export function initRemoveSavedLinks(deps: {
	forEachRemovalCandidatePage: ForEachRemovalCandidatePage;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	listReadlistDefinitions: ListReadlistDefinitions;
	listAllUserHighlights: ListAllUserHighlights;
	moveNewsletterLinkToHold: MoveNewsletterLinkToHold;
	findOriginalUrls: FindOriginalUrls;
	forEachRemovableEmailPage: InboxEmailStore["forEachRemovableEmailPage"];
	markEmailRemoved: InboxEmailStore["markEmailRemoved"];
	scheduleRemovedIssuesPurge: ScheduleRemovedIssuesPurge;
	publishEvent: PublishEvent;
	now: () => Date;
}): RunSavedLinksJobAction {
	return async ({ userId, jobId, detail, counts: seeded, resumed, recordProgress }) => {
		const job = detail.job;
		assert(job.action === "remove", "the remove runner takes a remove job");
		const runStartedAt = deps.now();
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
								kind: "link",
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
		const highlights = await deps.listAllUserHighlights(userId);
		const highlighted = new Set(highlights.map((highlight) => highlight.highlightOf));
		let scheduled = false;
		await deps.forEachRemovableEmailPage({
			userId,
			onPage: async (emails) => {
				const chosen = emails.filter(
					(email) =>
						email.removal === undefined &&
						email.receivedAt <= cutoff.toISOString() &&
						isChosenSender({ senders: job.senders, senderEmail: email.senderEmail }),
				);
				for (const chunk of chunksOf({ items: chosen, size: SAVED_LINKS_JOB_CHUNK_SIZE })) {
					if (stale) return;
					if (!scheduled) {
						await deps.scheduleRemovedIssuesPurge({ userId, jobId, runStartedAt });
						scheduled = true;
					}
					const outcomes = await Promise.all(chunk.map((email) => removeIssue({ userId, jobId, email, cutoff, readlists, highlighted, senders: job.senders })));
					const held: string[] = [];
					for (const outcome of outcomes) {
						if (outcome.kind === "held") held.push(outcome.storedKey);
						if (outcome.kind === "skipped") counts = addSavedLinksJobCount({ counts, code: outcome.reason, by: 1 });
					}
					counts = addSavedLinksJobCount({ counts, code: "held-issue", by: held.length });
					await publishDequeued({ userId, storedKeys: held });
					stale = (await recordProgress(counts)).outcome === "stale";
				}
			},
		});
		if (stale) return { outcome: "stale" };
		return { outcome: "finished", counts };
	};

	async function removeIssue(params: {
		userId: UserId;
		jobId: SavedLinksJobId;
		email: RemovableInboxEmail;
		cutoff: Date;
		readlists: Parameters<MoveNewsletterLinkToHold>[0]["readlists"];
		highlighted: ReadonlySet<string>;
		senders: Parameters<MoveNewsletterLinkToHold>[0]["senders"];
	}) {
		const { userId, jobId, email } = params;
		const storedKey = emailIssueStoredKey({ userId, receivedAtMessageId: email.receivedAtMessageId });
		if (params.highlighted.has(storedKey)) return { kind: "skipped" as const, reason: "highlighted" as const };
		const move = await deps.moveNewsletterLinkToHold({
			userId,
			jobId,
			storedKey,
			cutoff: params.cutoff,
			senders: params.senders,
			readlists: params.readlists,
			kind: "issue",
			now: deps.now(),
		});
		if (move.outcome === "skipped") return { kind: "skipped" as const, reason: move.reason };
		await deps.markEmailRemoved({ userId, receivedAtMessageId: email.receivedAtMessageId, jobId, at: deps.now() });
		return move.outcome === "held" ? { kind: "held" as const, storedKey } : { kind: "absent" as const };
	}

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
		const issues = [...storedKeys].filter((storedKey) => isNewsletterIssueKey({ storedKey, userId: params.userId })).length;
		return { ...params.counts, held: storedKeys.size - issues, "held-issue": issues };
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
