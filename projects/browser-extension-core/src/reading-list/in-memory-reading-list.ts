import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";
import type {
	FindByUrl,
	GetAllItems,
	InvokeAction,
	SaveUrl,
	SaveUrls,
} from "./reading-list.types";

export function initInMemoryReadingList(): {
	saveUrl: SaveUrl;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getAllItems: GetAllItems;
	saveUrls: SaveUrls;
} {
	const items = new Map<ReadingListItemId, ReadingListItem>();

	const saveUrl: SaveUrl = async ({ url, title }) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return { ok: false, reason: "already-saved" };
			}
		}

		const id = crypto.randomUUID() as ReadingListItemId;
		/** Mirrors the server's per-item affordances: a removing `delete` and a
		 * non-removing `update-status`. Advertising both lets the fake exercise an
		 * action-aware invoke — only `delete` removes — instead of deleting on any
		 * advertised action, which would mask a walker bug. */
		const item: ReadingListItem = {
			id,
			url,
			title,
			savedAt: new Date(),
			actions: [{ name: "delete" }, { name: "update-status" }],
			links: [],
		};
		items.set(id, item);
		return { ok: true, item };
	};

	/** Action names this fake treats as removing the item from the list. Keeping
	 * the set explicit makes the fake action-aware: only a removing action deletes,
	 * so a non-removing advertised action (e.g. `update-status`) returns the list
	 * unchanged rather than masking a bug by deleting on any advertised action. */
	const REMOVING_ACTIONS = new Set(["delete"]);

	const invokeAction: InvokeAction = async ({ id, name }) => {
		const item = items.get(id);
		/** The fake mirrors the Siren walker: an item or action the store no longer
		 * advertises reports not-found. */
		if (!item?.actions.some((action) => action.name === name)) {
			return { ok: false, reason: "not-found" };
		}
		if (REMOVING_ACTIONS.has(name)) items.delete(id);
		return { ok: true, items: Array.from(items.values()) };
	};

	const findByUrl: FindByUrl = async (url) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return item;
			}
		}
		return null;
	};

	const getAllItems: GetAllItems = async () => {
		return Array.from(items.values());
	};

	const saveUrls: SaveUrls = async ({ urls }) => {
		let saved = 0;
		const skippedUrls: { url: string; code: string }[] = [];
		for (const url of urls) {
			const result = await saveUrl({ url, title: url });
			if (result.ok) {
				saved += 1;
			} else {
				skippedUrls.push({ url, code: "already-saved" });
			}
		}
		return { saved, skipped: skippedUrls.length, failed: 0, skippedUrls };
	};

	return {
		saveUrl,
		invokeAction,
		findByUrl,
		getAllItems,
		saveUrls,
	};
}
