import { ReadingListItemIdSchema } from "../domain/reading-list-item-id";
import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";
import type {
	CollectionPage,
	FindByUrl,
	GetItems,
	LoadPage,
	LoadSort,
	InvokeAction,
	SaveUrl,
} from "./reading-list.types";

export function initInMemoryReadingList(): {
	saveUrl: SaveUrl;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getItems: GetItems;
	loadPage: LoadPage;
	loadSort: LoadSort;
} {
	const items = new Map<ReadingListItemId, ReadingListItem>();

	function wholeList(): CollectionPage {
		return { items: Array.from(items.values()), pages: [], total: undefined, sort: [] };
	}

	const saveUrl: SaveUrl = async ({ url, title }) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return { ok: false, reason: "already-saved" };
			}
		}

		const id = ReadingListItemIdSchema.parse(crypto.randomUUID());
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
			needsBrowserCapture: false,
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
		return { ok: true, ...wholeList(), targetUrl: item.url };
	};

	const findByUrl: FindByUrl = async (url) => {
		for (const item of items.values()) {
			if (item.url === url) {
				return item;
			}
		}
		return null;
	};

	const getItems: GetItems = async () => wholeList();

	const loadPage: LoadPage = async () => wholeList();

	const loadSort: LoadSort = async () => wholeList();

	return {
		saveUrl,
		invokeAction,
		findByUrl,
		getItems,
		loadPage,
		loadSort,
	};
}
