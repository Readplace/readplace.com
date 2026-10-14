import assert from "node:assert/strict";
import { type HiddenTabApi, initOpenHiddenTab } from "./hidden-tab";

const TAB_ID = 42;
const ARTICLE_URL = "https://example.com/a";
const CAPTURE_TIMEOUT_MS = 5_000;

type CreateProperties = Parameters<HiddenTabApi["create"]>[0];
type UpdatedListener = (tabId: number, changeInfo: { status?: string }) => void;
type RemovedListener = (tabId: number) => void;

interface TabEvents {
	fireUpdated: (tabId: number, changeInfo: { status?: string }) => void;
	fireRemoved: (tabId: number) => void;
	listenerCount: () => number;
}

function createTabs(
	options: {
		create?: (events: TabEvents) => Promise<{ id?: number }>;
		reply?: () => Promise<unknown>;
	} = {},
) {
	const updatedListeners = new Set<UpdatedListener>();
	const removedListeners = new Set<RemovedListener>();
	const created: CreateProperties[] = [];
	const sent: { tabId: number; message: unknown }[] = [];
	const removed: number[] = [];

	const events: TabEvents = {
		fireUpdated: (tabId, changeInfo) => {
			for (const listener of updatedListeners) listener(tabId, changeInfo);
		},
		fireRemoved: (tabId) => {
			for (const listener of removedListeners) listener(tabId);
		},
		listenerCount: () => updatedListeners.size + removedListeners.size,
	};

	const tabs: HiddenTabApi = {
		create: async (createProperties) => {
			created.push(createProperties);
			return options.create ? options.create(events) : { id: TAB_ID };
		},
		remove: async (tabId) => {
			removed.push(tabId);
		},
		sendMessage: async (tabId, message) => {
			sent.push({ tabId, message });
			return options.reply ? options.reply() : undefined;
		},
		onUpdated: {
			addListener: (listener) => {
				updatedListeners.add(listener);
			},
			removeListener: (listener) => {
				updatedListeners.delete(listener);
			},
		},
		onRemoved: {
			addListener: (listener) => {
				removedListeners.add(listener);
			},
			removeListener: (listener) => {
				removedListeners.delete(listener);
			},
		},
	};

	return { tabs, created, sent, removed, ...events };
}

function createTimers() {
	const scheduled: { ms: number; fire: () => void }[] = [];
	return {
		timers: {
			after: (ms: number) =>
				new Promise<"timeout">((resolve) => {
					scheduled.push({ ms, fire: () => resolve("timeout") });
				}),
		},
		scheduled,
	};
}

function openWith(fake: ReturnType<typeof createTabs>, timers = createTimers()) {
	return initOpenHiddenTab({ tabs: fake.tabs, timers: timers.timers, captureTimeoutMs: CAPTURE_TIMEOUT_MS });
}

async function stillWaiting(load: Promise<unknown>): Promise<unknown> {
	return Promise.race([load, Promise.resolve("still waiting")]);
}

describe("initOpenHiddenTab", () => {
	it("creates the tab inactive beside the opener", async () => {
		const fake = createTabs();

		const tab = await openWith(fake)({ url: ARTICLE_URL, openerTabId: 7 });

		assert.deepEqual(fake.created, [{ url: ARTICLE_URL, active: false, openerTabId: 7 }]);
		assert.equal(tab.tabId, TAB_ID);
	});

	it("attaches its listeners before creating the tab", async () => {
		const listenersAtCreate: number[] = [];
		const fake = createTabs({
			create: async (events) => {
				listenersAtCreate.push(events.listenerCount());
				return { id: TAB_ID };
			},
		});

		await openWith(fake)({ url: ARTICLE_URL });

		assert.deepEqual(listenersAtCreate, [2]);
	});

	it("resolves nextLoad when the tab's complete fired before create resolved", async () => {
		const fake = createTabs({
			create: async (events) => {
				events.fireUpdated(TAB_ID, { status: "complete" });
				return { id: TAB_ID };
			},
		});

		const tab = await openWith(fake)({ url: ARTICLE_URL });

		assert.equal(await tab.nextLoad(), "complete");
	});

	it("resolves nextLoad on every complete after create, whether or not it is awaited yet", async () => {
		const fake = createTabs();
		const tab = await openWith(fake)({ url: ARTICLE_URL });

		fake.fireUpdated(TAB_ID, { status: "complete" });
		assert.equal(await tab.nextLoad(), "complete");
		const next = tab.nextLoad();
		fake.fireUpdated(TAB_ID, { status: "loading" });
		assert.equal(await stillWaiting(next), "still waiting");
		fake.fireUpdated(TAB_ID, { status: "complete" });

		assert.equal(await next, "complete");
	});

	it("resolves removed when the tab closes first", async () => {
		const fake = createTabs();
		const tab = await openWith(fake)({ url: ARTICLE_URL });

		const next = tab.nextLoad();
		fake.fireRemoved(TAB_ID);

		assert.equal(await next, "removed");
	});

	it("ignores other tabs' updates, including those seen before the id was known", async () => {
		const fake = createTabs({
			create: async (events) => {
				events.fireUpdated(41, { status: "complete" });
				events.fireRemoved(41);
				return { id: TAB_ID };
			},
		});
		const tab = await openWith(fake)({ url: ARTICLE_URL });

		const next = tab.nextLoad();
		fake.fireUpdated(43, { status: "complete" });
		fake.fireRemoved(43);
		assert.equal(await stillWaiting(next), "still waiting");
		fake.fireRemoved(TAB_ID);

		assert.equal(await next, "removed");
	});

	it("captures through capture-html and parses the answer", async () => {
		const fake = createTabs({
			reply: async () => ({
				rawHtml: "<html><body>A</body></html>",
				title: "A",
				canonicalUrl: ARTICLE_URL,
				responseStatus: 200,
			}),
		});
		const tab = await openWith(fake)({ url: ARTICLE_URL });

		assert.deepEqual(await tab.captureHtml(), {
			rawHtml: "<html><body>A</body></html>",
			title: "A",
			responseStatus: 200,
		});
		assert.deepEqual(fake.sent, [{ tabId: TAB_ID, message: { type: "capture-html" } }]);
	});

	it("times out a silent content script", async () => {
		const timers = createTimers();
		const fake = createTabs({ reply: () => new Promise(() => {}) });
		const tab = await openWith(fake, timers)({ url: ARTICLE_URL });

		const answer = tab.captureHtml();
		assert.deepEqual(
			timers.scheduled.map(({ ms }) => ms),
			[CAPTURE_TIMEOUT_MS],
		);
		timers.scheduled[0].fire();

		assert.equal(await answer, undefined);
	});

	it("answers nothing when no content script runs in the tab or its reply is not a capture", async () => {
		const unscripted = createTabs({
			reply: async () => {
				throw new Error("Could not establish connection. Receiving end does not exist.");
			},
		});
		const foreign = createTabs({ reply: async () => ({ html: "<html></html>" }) });

		const unscriptedTab = await openWith(unscripted)({ url: ARTICLE_URL });
		const foreignTab = await openWith(foreign)({ url: ARTICLE_URL });

		assert.equal(await unscriptedTab.captureHtml(), undefined);
		assert.equal(await foreignTab.captureHtml(), undefined);
	});

	it("closes the tab and detaches its listeners", async () => {
		const fake = createTabs();
		const tab = await openWith(fake)({ url: ARTICLE_URL });

		await tab.close();

		assert.deepEqual(fake.removed, [TAB_ID]);
		assert.equal(fake.listenerCount(), 0);
	});

	it("detaches its listeners when the tab cannot be created", async () => {
		const fake = createTabs({
			create: async () => {
				throw new Error("Tabs cannot be edited right now (user may be dragging a tab).");
			},
		});

		await assert.rejects(openWith(fake)({ url: ARTICLE_URL }), /cannot be edited/);

		assert.equal(fake.listenerCount(), 0);
	});

	it("refuses a created tab that has no id, detaching its listeners", async () => {
		const fake = createTabs({ create: async () => ({}) });

		await assert.rejects(openWith(fake)({ url: ARTICLE_URL }), /without an id/);

		assert.equal(fake.listenerCount(), 0);
	});
});
