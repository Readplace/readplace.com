import assert from "node:assert";
import type {
	InboxEmailLinkEntry,
	InboxEmailLinkStore,
	InboxEmailLinksMeta,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

export function initInMemoryInboxEmailLink(): InboxEmailLinkStore {
	const links = new Map<string, InboxEmailLinkEntry>();
	const metas = new Map<string, InboxEmailLinksMeta>();
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
	};

	return {
		putLink: async (link) => {
			const key = linkKey(groupKey(link), link.ordinal);
			if (links.has(key)) return "duplicate";
			links.set(key, link);
			return "stored";
		},
		setLinkOutcome: async ({ userId, receivedAtMessageId, ordinal, outcome }) => {
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
		putLinksMeta: async ({ userId, receivedAtMessageId, meta }) => {
			metas.set(groupKey({ userId, receivedAtMessageId }), meta);
		},
		listLinksByEmail: async ({ userId, receivedAtMessageId }) => {
			const group = groupKey({ userId, receivedAtMessageId });
			const list = [...links.values()]
				.filter((link) => groupKey(link) === group)
				.sort((a, b) => (a.ordinal < b.ordinal ? -1 : 1));
			return { links: list, meta: metas.get(group) };
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
