import type {
	NewsletterMessage,
	NewsletterMessageStore,
	NewsletterMessageSummary,
} from "@packages/domain/newsletter";

function toSummary(message: NewsletterMessage): NewsletterMessageSummary {
	return {
		id: message.id,
		subject: message.subject,
		receivedAt: message.receivedAt,
		savedCount: message.savedLinks.length,
	};
}

export function initInMemoryNewsletterMessages(): NewsletterMessageStore {
	const byUser = new Map<string, NewsletterMessage[]>();

	return {
		recordMessage: async (message) => {
			const existing = byUser.get(message.userId);
			const list = existing ?? [];
			list.push(message);
			byUser.set(message.userId, list);
		},
		listMessages: async (userId) => {
			const list = byUser.get(userId) ?? [];
			return [...list]
				.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
				.map(toSummary);
		},
		findMessage: async ({ userId, id }) => {
			const list = byUser.get(userId) ?? [];
			return list.find((message) => message.id === id);
		},
	};
}
