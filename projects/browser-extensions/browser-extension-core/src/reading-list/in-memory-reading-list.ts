import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";
import type {
	FindByUrl,
	GetItems,
	GetMoreItems,
	InvokeAction,
	SaveUrl,
	SavePages,
} from "./reading-list.types";

export function initInMemoryReadingList(): {
	saveUrl: SaveUrl;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getItems: GetItems;
	getMoreItems: GetMoreItems;
	savePages: SavePages;
} {
	const items = new Map<ReadingListItemId, ReadingListItem>();

	const saveUrl: SaveUrl = async ({ url, title }) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return { ok: false, reason: "already-saved" };
			}
		}

		const id = crypto.randomUUID() as ReadingListItemId;
		/** Advertise a single per-item action (`update-status`): invoking an
		 * advertised action returns the current list, matching the real contract
		 * where no per-item action reaching the extension removes an article. */
		const item: ReadingListItem = {
			id,
			url,
			title,
			savedAt: new Date(),
			actions: [{ name: "update-status" }],
			links: [],
		};
		items.set(id, item);
		return { ok: true, item, messages: [] };
	};

	const invokeAction: InvokeAction = async ({ id, name }) => {
		const item = items.get(id);
		/** A missing item, or an action the store does not advertise, reports
		 * not-found — matching how a real client treats a withdrawn affordance. */
		if (!item?.actions.some((action) => action.name === name)) {
			return { ok: false, reason: "not-found" };
		}
		return {
			ok: true,
			items: Array.from(items.values()),
			hasMore: false,
			targetUrl: item.url,
		};
	};

	const findByUrl: FindByUrl = async (url) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return item;
			}
		}
		return null;
	};

	const getItems: GetItems = async () => ({ items: Array.from(items.values()), hasMore: false });

	const getMoreItems: GetMoreItems = async () => ({ items: Array.from(items.values()), hasMore: false });

	const savePages: SavePages = async ({ pages }) => {
		let saved = 0;
		const skippedUrls: { url: string; code: string }[] = [];
		for (const page of pages) {
			const result = await saveUrl({ url: page.url, title: page.title ?? page.url });
			if (result.ok) {
				saved += 1;
			} else {
				skippedUrls.push({ url: page.url, code: "already-saved" });
			}
		}
		return { saved, skipped: skippedUrls.length, failed: 0, tooBig: [], skippedUrls };
	};

	return {
		saveUrl,
		invokeAction,
		findByUrl,
		getItems,
		getMoreItems,
		savePages,
	};
}
