import {
	type InboxLinkSaveState,
	type InboxSavedLinkStore,
	inboxSavedLinkKey,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

export function initInMemoryInboxSavedLink(): InboxSavedLinkStore {
	const states = new Map<string, InboxLinkSaveState>();
	const rowKey = (userId: UserId, linkKey: string) => `${userId}#${linkKey}`;

	const putState = async (input: {
		userId: UserId;
		url: string;
		state: InboxLinkSaveState;
		onlyIfNotSaved?: boolean;
	}) => {
		const key = rowKey(input.userId, inboxSavedLinkKey(input.url));
		// The link is already recorded as saved, which outranks the failure.
		if (input.onlyIfNotSaved === true && states.get(key) === "saved") return;
		states.set(key, input.state);
	};

	return {
		markLinkSaved: ({ userId, url }) => putState({ userId, url, state: "saved" }),
		markLinkSaveFailed: ({ userId, url }) =>
			putState({ userId, url, state: "failed", onlyIfNotSaved: true }),
		findSavedLinks: async ({ userId, urls }) => {
			const byUrl = new Map<string, InboxLinkSaveState>();
			for (const url of urls) {
				let linkKey: string;
				try {
					linkKey = inboxSavedLinkKey(url);
				} catch {
					continue;
				}
				const state = states.get(rowKey(userId, linkKey));
				if (state !== undefined) byUrl.set(url, state);
			}
			return byUrl;
		},
		deleteAllByUserId: async (userId) => {
			const prefix = `${userId}#`;
			for (const key of [...states.keys()]) {
				if (key.startsWith(prefix)) states.delete(key);
			}
		},
	};
}
