import assert from "node:assert";
import type {
	InboxEmailLinkEntry,
	InboxEmailLinkStore,
	InboxEmailLinksMeta,
	InboxReadlistOutcome,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

export function initInMemoryInboxEmailLink(): InboxEmailLinkStore {
	const links = new Map<string, InboxEmailLinkEntry>();
	const metas = new Map<string, InboxEmailLinksMeta>();
	const outcomes = new Map<string, Map<string, InboxReadlistOutcome>>();
	const groupKey = (input: { userId: UserId; receivedAtMessageId: string }) =>
		`${input.userId}#${input.receivedAtMessageId}`;
	const linkKey = (group: string, ordinal: string) => `${group}#${ordinal}`;

	const deleteLinksByEmail: InboxEmailLinkStore["deleteLinksByEmail"] = async ({
		userId,
		receivedAtMessageId,
	}) => {
		const group = groupKey({ userId, receivedAtMessageId });
		for (const [key, link] of links) {
			if (groupKey(link) === group) links.delete(key);
		}
		metas.delete(group);
		outcomes.delete(group);
	};

	return {
		putLink: async (link) => {
			const key = linkKey(groupKey(link), link.ordinal);
			if (links.has(key)) return "duplicate";
			links.set(key, link);
			return "stored";
		},
		setLinkOutcome: async ({
			userId,
			receivedAtMessageId,
			ordinal,
			outcome,
		}) => {
			const key = linkKey(groupKey({ userId, receivedAtMessageId }), ordinal);
			const existing = links.get(key);
			assert(existing, "setLinkOutcome on a link that was never stored");
			links.set(
				key,
				outcome.status === "crawled"
					? {
							...existing,
							status: "crawled",
							title: outcome.title,
							excerpt: outcome.excerpt,
							siteName: outcome.siteName,
							imageUrl: outcome.imageUrl,
							resolvedUrl: outcome.resolvedUrl,
							failureReason: undefined,
							skipReason: undefined,
						}
					: {
							...existing,
							status: "failed",
							failureReason: outcome.failureReason,
							title: undefined,
							excerpt: undefined,
							siteName: undefined,
							imageUrl: undefined,
							resolvedUrl: undefined,
							skipReason: undefined,
						},
			);
		},
		failPendingLink: async ({
			userId,
			receivedAtMessageId,
			ordinal,
			failureReason,
		}) => {
			const key = linkKey(groupKey({ userId, receivedAtMessageId }), ordinal);
			const existing = links.get(key);
			if (existing === undefined || existing.status !== "pending")
				return "already-terminal";
			links.set(key, {
				...existing,
				status: "failed",
				failureReason,
				title: undefined,
				excerpt: undefined,
				siteName: undefined,
				imageUrl: undefined,
				resolvedUrl: undefined,
				skipReason: undefined,
			});
			return "failed";
		},
		putLinksMeta: async ({ userId, receivedAtMessageId, meta }) => {
			const group = groupKey({ userId, receivedAtMessageId });
			const existingMeta = metas.get(group);
			const existing = existingMeta?.readlistDecision;
			metas.set(group, {
				truncated: meta.truncated,
				extractionFailed: meta.extractionFailed,
				...((existingMeta?.selectedReadlists ?? meta.selectedReadlists) ===
				undefined
					? {}
					: {
							selectedReadlists:
								existingMeta?.selectedReadlists ?? meta.selectedReadlists,
						}),
				...((existingMeta?.eligibleArticleCount ?? meta.eligibleArticleCount) === undefined ? {} : { eligibleArticleCount: existingMeta?.eligibleArticleCount ?? meta.eligibleArticleCount }),
				...((existingMeta?.savesHeld ?? meta.savesHeld) === undefined ? {} : { savesHeld: existingMeta?.savesHeld ?? meta.savesHeld }),
				readlistDecision:
					meta.readlistDecision === undefined
						? existing
						: (existing ?? {
								state: "deciding",
								readlist: meta.readlistDecision.readlist,
							}),
			});
		},
		markLinksExtractionFailed: async ({ userId, receivedAtMessageId }) => {
			const group = groupKey({ userId, receivedAtMessageId });
			if (metas.has(group)) return "superseded";
			metas.set(group, {
				truncated: false,
				extractionFailed: true,
				readlistDecision: undefined,
			});
			return "stored";
		},
		markLinkDropped: async ({
			userId,
			receivedAtMessageId,
			ordinal,
			droppedFor,
		}) => {
			const key = linkKey(groupKey({ userId, receivedAtMessageId }), ordinal);
			const existing = links.get(key);
			if (existing === undefined || existing.status === "skipped")
				return "not-a-candidate";
			links.set(key, { ...existing, droppedFor });
			return "marked";
		},
		settleReadlistDecision: async ({
			userId,
			receivedAtMessageId,
			decision,
		}) => {
			const group = groupKey({ userId, receivedAtMessageId });
			const meta = metas.get(group);
			assert(meta, "readlist decision arrived before the extraction barrier");
			if (meta.readlistDecision?.state !== "deciding") return "already-settled";
			metas.set(group, { ...meta, readlistDecision: decision });
			return "settled";
		},
		putReadlistOutcome: async ({ userId, receivedAtMessageId, outcome }) => {
			const group = groupKey({ userId, receivedAtMessageId });
			const results =
				outcomes.get(group) ?? new Map<string, InboxReadlistOutcome>();
			if (results.has(outcome.readlist)) return "duplicate";
			results.set(outcome.readlist, outcome);
			outcomes.set(group, results);
			return "stored";
		},
		listLinksByEmail: async ({ userId, receivedAtMessageId }) => {
			const group = groupKey({ userId, receivedAtMessageId });
			const list = [...links.values()]
				.filter((link) => groupKey(link) === group)
				.sort((a, b) => (a.ordinal < b.ordinal ? -1 : 1));
			const meta = metas.get(group);
			return {
				links: list,
				meta:
					meta?.selectedReadlists === undefined
						? meta
						: {
								...meta,
								readlistOutcomes: [...(outcomes.get(group)?.values() ?? [])],
							},
			};
		},
		getLink: async ({ userId, receivedAtMessageId, ordinal }) =>
			links.get(linkKey(groupKey({ userId, receivedAtMessageId }), ordinal)),
		deleteLinksByEmail,
		deleteAllLinksByUserId: async (userId, receivedAtMessageIds) => {
			for (const receivedAtMessageId of receivedAtMessageIds) {
				await deleteLinksByEmail({ userId, receivedAtMessageId });
			}
		},
	};
}
