import assert from "node:assert/strict";
import { ARTICLE_VERSION_HEADER, OFFLINE_SAVED_AT_HEADER, stampOfflineCopy as contractStamp } from "./offline-cache";
import {
	type OfflineReaderWorkerDeps,
	initOfflineReaderWorker,
	stampOfflineCopy,
} from "./offline-reader-worker.client";

const ORIGIN = "https://readplace.com";
const CACHE_NAME = "readplace-offline-v1";
const READER_URL = `${ORIGIN}/queue/abc123/view?v=token`;
const READER_KEY = `${ORIGIN}/queue/abc123/view`;
const READER_PATH = "/queue/abc123/view";
const STORED_ETAG = 'W/"stored-page"';
const ONLINE_ETAG = 'W/"online-page"';
const STORED_VERSION = "5f3c0e9a7b21d844";
const ONLINE_VERSION = "c0ffee00d15ea5e1";
const IMAGE_URL = "https://cdn.readplace.com/media/photo.png?w=640";
const NETWORK_DOWN = new TypeError("Failed to fetch");
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SAVED_NOW = new Date(NOW).toISOString();
const SAVED_YESTERDAY = new Date(NOW - DAY_MS).toISOString();
const SAVED_31_DAYS_AGO = new Date(NOW - 31 * DAY_MS).toISOString();

type WorkerResponse = Awaited<ReturnType<OfflineReaderWorkerDeps["fetchFn"]>>;

const labels = new WeakMap<WorkerResponse, string>();

function fakeResponse(
	label: string,
	options: {
		status?: number;
		redirected?: boolean;
		contentType?: string | null;
		savedAt?: string;
		etag?: string | null;
		version?: string | null;
	} = {},
): WorkerResponse {
	const status = options.status ?? 200;
	const contentType = options.contentType === undefined ? "text/html; charset=utf-8" : options.contentType;
	const headers = new Map([
		["content-type", contentType],
		[OFFLINE_SAVED_AT_HEADER.toLowerCase(), options.savedAt ?? null],
		["etag", options.etag ?? null],
		[ARTICLE_VERSION_HEADER.toLowerCase(), options.version ?? null],
	]);
	const response: WorkerResponse = {
		ok: status >= 200 && status < 300,
		status,
		redirected: options.redirected ?? false,
		headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
		clone: () => fakeResponse(`copy of ${label}`, options),
	};
	labels.set(response, label);
	return response;
}

function datedCopy(response: WorkerResponse, savedAt: number): WorkerResponse {
	const label = labels.get(response);
	assert(label, "the worker dates only a response it fetched or stored");
	return fakeResponse(label, {
		status: response.status,
		redirected: response.redirected,
		contentType: response.headers.get("Content-Type"),
		savedAt: new Date(savedAt).toISOString(),
		etag: response.headers.get("ETag"),
		version: response.headers.get(ARTICLE_VERSION_HEADER),
	});
}

function fakeRequest(input: {
	url: string;
	method?: string;
	mode?: string;
	destination?: string;
	headers?: Record<string, string>;
}) {
	const headers = input.headers ?? {};
	return {
		url: input.url,
		method: input.method ?? "GET",
		mode: input.mode ?? "navigate",
		destination: input.destination ?? "document",
		headers: {
			get: (name: string) =>
				Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null,
		},
	};
}

function deferred() {
	const settle: { resolve: (response: WorkerResponse) => void; reject: (reason: unknown) => void } = {
		resolve: () => {},
		reject: () => {},
	};
	const promise = new Promise<WorkerResponse>((resolve, reject) => {
		settle.resolve = resolve;
		settle.reject = reject;
	});
	return { promise, resolve: settle.resolve, reject: settle.reject };
}

function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

type LifecycleListener = Parameters<OfflineReaderWorkerDeps["addInstallListener"]>[0];
type FetchListener = Parameters<OfflineReaderWorkerDeps["addFetchListener"]>[0];
type MessageListener = Parameters<OfflineReaderWorkerDeps["addMessageListener"]>[0];
type ReaderTab = Parameters<MessageListener>[0]["source"];

function startWorker(options: {
	fetch: OfflineReaderWorkerDeps["fetchFn"];
	cached?: Record<string, Record<string, WorkerResponse>>;
	navigationPreload?: boolean;
	goneClients?: string[];
}) {
	const listeners: {
		install?: LifecycleListener;
		activate?: LifecycleListener;
		fetch?: FetchListener;
		message?: MessageListener;
	} = {};
	const calls: string[] = [];
	const told: Array<{ clientId: string; message: unknown }> = [];
	const storedWhenTold: Array<Record<string, string | undefined>> = [];
	const fetched: Array<{ input: unknown; init: unknown }> = [];
	const matchedWith: unknown[] = [];
	const timeouts: Array<{ fire: () => void; ms: number }> = [];
	const stores = new Map(
		Object.entries(options.cached ?? {}).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
	);
	const goneClients = options.goneClients ?? [];

	function tab(clientId: string): ReaderTab {
		return {
			postMessage(message) {
				told.push({ clientId, message });
				storedWhenTold.push(storedLabels());
			},
		};
	}

	initOfflineReaderWorker({
		origin: ORIGIN,
		async skipWaiting() {
			calls.push("skipWaiting");
		},
		async claimClients() {
			calls.push("claim");
		},
		async findClient(clientId) {
			if (goneClients.includes(clientId)) return undefined;
			return tab(clientId);
		},
		navigationPreload: options.navigationPreload
			? {
					async enable() {
						calls.push("enableNavigationPreload");
					},
				}
			: undefined,
		addInstallListener(listener) {
			listeners.install = listener;
		},
		addActivateListener(listener) {
			listeners.activate = listener;
		},
		addFetchListener(listener) {
			listeners.fetch = listener;
		},
		addMessageListener(listener) {
			listeners.message = listener;
		},
		caches: {
			async open(name) {
				const store = stores.get(name) ?? new Map<string, WorkerResponse>();
				stores.set(name, store);
				return {
					async match(key, matchOptions) {
						matchedWith.push(matchOptions);
						return store.get(key);
					},
					async put(key, response) {
						store.set(key, response);
					},
					async delete(key) {
						return store.delete(key);
					},
					async keys() {
						return Array.from(store.keys(), (url) => ({ url }));
					},
				};
			},
			async keys() {
				return Array.from(stores.keys());
			},
			async delete(name) {
				return stores.delete(name);
			},
		},
		fetchFn: (input, init) => {
			fetched.push({ input, init });
			return options.fetch(input, init);
		},
		setTimeoutFn: (fire, ms) => {
			timeouts.push({ fire, ms });
		},
		networkTimeoutMs: 3000,
		now: () => NOW,
		stampCopy: datedCopy,
	});

	function storedLabels(): Record<string, string | undefined> {
		const store = stores.get(CACHE_NAME) ?? new Map<string, WorkerResponse>();
		return Object.fromEntries(Array.from(store, ([key, response]) => [key, labels.get(response)]));
	}

	function storedSavedAt(): Record<string, string | null> {
		const store = stores.get(CACHE_NAME) ?? new Map<string, WorkerResponse>();
		return Object.fromEntries(
			Array.from(store, ([key, response]) => [key, response.headers.get(OFFLINE_SAVED_AT_HEADER)]),
		);
	}

	async function lifecycle(name: "install" | "activate"): Promise<void> {
		const waited: Promise<unknown>[] = [];
		const listener = listeners[name];
		assert(listener, `the worker must listen for ${name}`);
		listener({ waitUntil: (work) => waited.push(work) });
		expect(waited).toHaveLength(1);
		await Promise.all(waited);
	}

	function dispatchFetch(
		request: ReturnType<typeof fakeRequest>,
		event: {
			clientId?: string;
			resultingClientId?: string;
			preloadResponse?: Promise<WorkerResponse | undefined>;
		} = {},
	) {
		const responses: Promise<unknown>[] = [];
		const waited: Promise<unknown>[] = [];
		const listener = listeners.fetch;
		assert(listener, "the worker must listen for fetch");
		listener({
			request,
			clientId: event.clientId ?? "",
			resultingClientId: event.resultingClientId ?? "",
			preloadResponse: event.preloadResponse,
			respondWith: (response) => responses.push(response),
			waitUntil: (work) => waited.push(work),
		});
		return {
			responses,
			response: () => responses[0],
			settled: () => Promise.all(waited),
		};
	}

	function dispatchMessage(data: unknown) {
		const waited: Promise<unknown>[] = [];
		const listener = listeners.message;
		assert(listener, "the worker must listen for messages");
		listener({ data, source: tab("asking-tab"), waitUntil: (work) => waited.push(work) });
		return { waited, settled: () => Promise.all(waited) };
	}

	return {
		calls,
		told,
		storedWhenTold,
		fetched,
		matchedWith,
		timeouts,
		cacheNames: () => Array.from(stores.keys()),
		storedLabels,
		storedSavedAt,
		lifecycle,
		dispatchFetch,
		dispatchMessage,
	};
}

const neverFetched: OfflineReaderWorkerDeps["fetchFn"] = () => {
	throw new Error("the worker must leave this request to the browser");
};

describe("offline reader worker lifecycle", () => {
	it("takes over from a previous worker as soon as it is installed", async () => {
		const worker = startWorker({ fetch: neverFetched });

		await worker.lifecycle("install");

		expect(worker.calls).toEqual(["skipWaiting"]);
	});

	it("drops an older version of its cache, speeds navigations up with preload and claims the open pages", async () => {
		const worker = startWorker({
			fetch: neverFetched,
			navigationPreload: true,
			cached: {
				"readplace-offline-v0": {},
				[CACHE_NAME]: { [READER_KEY]: fakeResponse("stored reader", { savedAt: SAVED_YESTERDAY }) },
				"another-feature-v1": {},
			},
		});

		await worker.lifecycle("activate");

		expect(worker.cacheNames()).toEqual([CACHE_NAME, "another-feature-v1"]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "stored reader" });
		expect(worker.calls).toEqual(["enableNavigationPreload", "claim"]);
	});

	it("deletes every stored copy saved more than 30 days ago, or never dated, when it activates", async () => {
		const worker = startWorker({
			fetch: neverFetched,
			cached: {
				[CACHE_NAME]: {
					[READER_KEY]: fakeResponse("fresh reader", { savedAt: SAVED_YESTERDAY }),
					[`${ORIGIN}/queue`]: fakeResponse("expired listing", { savedAt: SAVED_31_DAYS_AGO }),
					[IMAGE_URL]: fakeResponse("undated image", { contentType: "image/png" }),
				},
			},
		});

		await worker.lifecycle("activate");

		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "fresh reader" });
		expect(worker.calls).toEqual(["claim"]);
	});

	it("still claims the open pages in a browser without navigation preload", async () => {
		const worker = startWorker({ fetch: neverFetched, navigationPreload: false });

		await worker.lifecycle("activate");

		expect(worker.calls).toEqual(["claim"]);
	});
});

describe("offline reader worker requests it leaves alone", () => {
	it.each([
		["a form post to the listing", fakeRequest({ url: `${ORIGIN}/queue/save`, method: "POST" })],
		["a non-GET navigation to the listing", fakeRequest({ url: `${ORIGIN}/queue`, method: "POST" })],
		[
			"a script's own fetch of a reader",
			fakeRequest({ url: READER_URL, mode: "cors", destination: "", headers: { Purpose: "prefetch" } }),
		],
		[
			"a card poll",
			fakeRequest({
				url: `${ORIGIN}/queue/abc123/card`,
				mode: "cors",
				destination: "",
				headers: { "HX-Request": "true" },
			}),
		],
		[
			"a boosted request to a page outside the readlist",
			fakeRequest({
				url: `${ORIGIN}/account`,
				mode: "cors",
				destination: "",
				headers: { "HX-Boosted": "true" },
			}),
		],
		["a navigation to the readlist preferences", fakeRequest({ url: `${ORIGIN}/queue/queues/work/preferences` })],
		[
			"a boosted request to another origin's listing",
			fakeRequest({
				url: "https://elsewhere.example/queue",
				mode: "cors",
				destination: "",
				headers: { "HX-Boosted": "true" },
			}),
		],
		["a stylesheet", fakeRequest({ url: `${ORIGIN}/client-dist/app.css`, mode: "no-cors", destination: "style" })],
		[
			"its own script, as the browser checks it for an update",
			fakeRequest({
				url: `${ORIGIN}/client-dist/offline-reader-worker.client.js`,
				mode: "same-origin",
				destination: "serviceworker",
			}),
		],
		[
			"the script that registers it",
			fakeRequest({ url: `${ORIGIN}/client-dist/offline-reader.client.js`, mode: "no-cors", destination: "script" }),
		],
	])("leaves %s to the browser", (_name, request) => {
		const worker = startWorker({ fetch: neverFetched });

		const event = worker.dispatchFetch(request, { clientId: "open-tab" });

		expect(event.responses).toEqual([]);
		expect(worker.fetched).toEqual([]);
	});
});

describe("offline reader worker pages", () => {
	it("serves a reader navigation from the network, keeps a copy and tells the new page it is live", async () => {
		const live = fakeResponse("live reader");
		const worker = startWorker({ fetch: async () => live });
		const request = fakeRequest({ url: READER_URL });

		const event = worker.dispatchFetch(request, {
			resultingClientId: "new-document",
			preloadResponse: Promise.resolve(undefined),
		});

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.fetched).toEqual([{ input: request, init: undefined }]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of live reader" });
		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: { type: "readplace:reader-source", source: "network", path: READER_PATH },
			},
		]);
	});

	it("serves a boosted listing request the same way, telling the page that asked", async () => {
		const live = fakeResponse("live listing");
		const worker = startWorker({ fetch: async () => live });

		const event = worker.dispatchFetch(
			fakeRequest({
				url: `${ORIGIN}/queue?utm_source=header-nav&tab=done&page=2`,
				mode: "cors",
				destination: "",
				headers: { "hx-boosted": "true", "HX-Request": "true" },
			}),
			{ clientId: "open-tab" },
		);

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.storedLabels()).toEqual({ [`${ORIGIN}/queue?page=2&tab=done`]: "copy of live listing" });
		expect(worker.told).toEqual([
			{ clientId: "open-tab", message: { type: "readplace:reader-source", source: "network", path: "/queue" } },
		]);
	});

	it("uses the response the browser preloaded while the worker was starting", async () => {
		const preloaded = fakeResponse("preloaded reader");
		const worker = startWorker({ fetch: neverFetched });

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
			preloadResponse: Promise.resolve(preloaded),
		});

		expect(await event.response()).toBe(preloaded);
		await event.settled();
		expect(worker.fetched).toEqual([]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of preloaded reader" });
	});

	it("falls back to the stored copy when the network is unreachable, telling the page it is an offline copy, when it was saved and which article version it is", async () => {
		const stored = fakeResponse("stored reader", { savedAt: SAVED_YESTERDAY, etag: STORED_ETAG, version: STORED_VERSION });
		const worker = startWorker({
			fetch: () => Promise.reject(NETWORK_DOWN),
			cached: { [CACHE_NAME]: { [READER_KEY]: stored } },
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			clientId: "previous-document",
			resultingClientId: "new-document",
		});

		expect(await event.response()).toBe(stored);
		await event.settled();
		expect(worker.matchedWith).toEqual([{ ignoreVary: true }]);
		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: {
					type: "readplace:reader-source",
					source: "offline-copy",
					path: READER_PATH,
					savedAt: SAVED_YESTERDAY,
					version: STORED_VERSION,
				},
			},
		]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "stored reader" });
	});

	it("falls back to the stored copy when the preload itself fails", async () => {
		const stored = fakeResponse("stored reader", { savedAt: SAVED_YESTERDAY, etag: STORED_ETAG, version: STORED_VERSION });
		const worker = startWorker({
			fetch: neverFetched,
			cached: { [CACHE_NAME]: { [READER_KEY]: stored } },
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
			preloadResponse: Promise.reject(NETWORK_DOWN),
		});

		expect(await event.response()).toBe(stored);
		await event.settled();
		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: {
					type: "readplace:reader-source",
					source: "offline-copy",
					path: READER_PATH,
					savedAt: SAVED_YESTERDAY,
					version: STORED_VERSION,
				},
			},
		]);
	});

	it("lets the browser show its own error page when the network is unreachable and nothing was stored", async () => {
		const worker = startWorker({ fetch: () => Promise.reject(NETWORK_DOWN) });

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});

		await expect(event.response()).rejects.toBe(NETWORK_DOWN);
		await event.settled();
		expect(worker.told).toEqual([]);
		expect(worker.storedLabels()).toEqual({});
	});

	it("dates the page it keeps with the time it saved it, replacing the copy stored before", async () => {
		const live = fakeResponse("live reader");
		const worker = startWorker({
			fetch: async () => live,
			cached: { [CACHE_NAME]: { [READER_KEY]: fakeResponse("older reader", { savedAt: SAVED_YESTERDAY }) } },
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of live reader" });
		expect(worker.storedSavedAt()).toEqual({ [READER_KEY]: SAVED_NOW });
	});

	it("never serves a stored page saved more than 30 days ago, and deletes it", async () => {
		const worker = startWorker({
			fetch: () => Promise.reject(NETWORK_DOWN),
			cached: { [CACHE_NAME]: { [READER_KEY]: fakeResponse("expired reader", { savedAt: SAVED_31_DAYS_AGO }) } },
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});

		await expect(event.response()).rejects.toBe(NETWORK_DOWN);
		await event.settled();
		expect(worker.told).toEqual([]);
		expect(worker.storedLabels()).toEqual({});
	});

	it("stops waiting for a slow network after three seconds and serves the stored copy, then keeps the late page and tells the page a newer version is online when the article version moved", async () => {
		const stored = fakeResponse("stored reader", { savedAt: SAVED_YESTERDAY, etag: STORED_ETAG, version: STORED_VERSION });
		const slow = deferred();
		const worker = startWorker({
			fetch: () => slow.promise,
			cached: { [CACHE_NAME]: { [READER_KEY]: stored } },
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});
		expect(worker.timeouts.map((timeout) => timeout.ms)).toEqual([3000]);
		worker.timeouts[0].fire();

		expect(await event.response()).toBe(stored);
		slow.resolve(fakeResponse("late reader", { etag: ONLINE_ETAG, version: ONLINE_VERSION }));
		await event.settled();
		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: {
					type: "readplace:reader-source",
					source: "offline-copy",
					path: READER_PATH,
					savedAt: SAVED_YESTERDAY,
					version: STORED_VERSION,
				},
			},
			{
				clientId: "new-document",
				message: { type: "readplace:reader-version", path: READER_PATH, version: "newer" },
			},
		]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of late reader" });
		expect(worker.storedWhenTold[1]).toEqual({ [READER_KEY]: "copy of late reader" });
	});

	it("tells the page the stored copy on screen is current when the late page carries the same article version, even as a page with another ETag", async () => {
		const slow = deferred();
		const worker = startWorker({
			fetch: () => slow.promise,
			cached: {
				[CACHE_NAME]: {
					[READER_KEY]: fakeResponse("stored reader", {
						savedAt: SAVED_YESTERDAY,
						etag: STORED_ETAG,
						version: STORED_VERSION,
					}),
				},
			},
		});

		const event = worker.dispatchFetch(
			fakeRequest({ url: READER_URL, mode: "cors", destination: "", headers: { "HX-Boosted": "true" } }),
			{ clientId: "open-tab" },
		);
		worker.timeouts[0].fire();
		await event.response();
		slow.resolve(fakeResponse("late reader", { etag: ONLINE_ETAG, version: STORED_VERSION }));
		await event.settled();

		expect(worker.told.map((told) => told.message)).toEqual([
			expect.objectContaining({ source: "offline-copy", version: STORED_VERSION }),
			{ type: "readplace:reader-version", path: READER_PATH, version: "same" },
		]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of late reader" });
	});

	it.each([
		["an error page", fakeResponse("late error", { status: 500, version: ONLINE_VERSION })],
		["a redirect to sign in", fakeResponse("late login", { redirected: true, version: ONLINE_VERSION })],
	])("says nothing more about the stored copy on screen when the late answer is %s", async (_name, late) => {
		const slow = deferred();
		const worker = startWorker({
			fetch: () => slow.promise,
			cached: {
				[CACHE_NAME]: { [READER_KEY]: fakeResponse("stored reader", { savedAt: SAVED_YESTERDAY, version: STORED_VERSION }) },
			},
		});

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), { resultingClientId: "new-document" });
		worker.timeouts[0].fire();
		await event.response();
		slow.resolve(late);
		await event.settled();

		expect(worker.told.map((told) => told.message)).toEqual([
			expect.objectContaining({ source: "offline-copy" }),
		]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "stored reader" });
	});

	it("keeps a listing's late page and tells the list on screen the network is back, a listing carrying no article version that could be newer", async () => {
		const listingKey = `${ORIGIN}/queue`;
		const slow = deferred();
		const worker = startWorker({
			fetch: () => slow.promise,
			cached: {
				[CACHE_NAME]: { [listingKey]: fakeResponse("stored listing", { savedAt: SAVED_YESTERDAY, etag: STORED_ETAG }) },
			},
		});

		const event = worker.dispatchFetch(fakeRequest({ url: listingKey }), { resultingClientId: "new-document" });
		worker.timeouts[0].fire();
		await event.response();
		slow.resolve(fakeResponse("late listing", { etag: ONLINE_ETAG }));
		await event.settled();

		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: {
					type: "readplace:reader-source",
					source: "offline-copy",
					path: "/queue",
					savedAt: SAVED_YESTERDAY,
					version: null,
				},
			},
			{
				clientId: "new-document",
				message: { type: "readplace:reader-version", path: "/queue", version: "same" },
			},
		]);
		expect(worker.storedLabels()).toEqual({ [listingKey]: "copy of late listing" });
		expect(worker.storedWhenTold[1]).toEqual({ [listingKey]: "copy of late listing" });
	});

	it("keeps waiting for a slow network when nothing was stored", async () => {
		const slow = deferred();
		const late = fakeResponse("late reader");
		const worker = startWorker({ fetch: () => slow.promise });

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});
		worker.timeouts[0].fire();
		slow.resolve(late);

		expect(await event.response()).toBe(late);
		await event.settled();
		expect(worker.told).toEqual([
			{
				clientId: "new-document",
				message: { type: "readplace:reader-source", source: "network", path: READER_PATH },
			},
		]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of late reader" });
	});

	it.each([
		["a not-found page", fakeResponse("not found", { status: 404 })],
		["a page reached through a redirect", fakeResponse("login", { redirected: true })],
		["a Siren document", fakeResponse("siren", { contentType: "application/vnd.siren+json" })],
		["a response without a content type", fakeResponse("untyped", { contentType: null })],
	])("hands %s through without keeping it or calling it a live page", async (_name, response) => {
		const worker = startWorker({ fetch: async () => response });

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});

		expect(await event.response()).toBe(response);
		await event.settled();
		expect(worker.storedLabels()).toEqual({});
		expect(worker.told).toEqual([]);
	});

	it("serves the page even when the tab that asked for it is gone before it can be told", async () => {
		const live = fakeResponse("live reader");
		const worker = startWorker({ fetch: async () => live, goneClients: ["new-document"] });

		const event = worker.dispatchFetch(fakeRequest({ url: READER_URL }), {
			resultingClientId: "new-document",
		});

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.told).toEqual([]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of live reader" });
	});
});

describe("offline reader worker revalidation", () => {
	const revalidation = { type: "readplace:revalidate-reader", url: READER_URL, version: STORED_VERSION };

	it("fetches the reader the page asks about past the browser's HTTP cache, keeps it, then answers that a newer version is online when its article version differs from the copy on screen", async () => {
		const worker = startWorker({
			fetch: async () => fakeResponse("online reader", { etag: ONLINE_ETAG, version: ONLINE_VERSION }),
		});

		await worker.dispatchMessage(revalidation).settled();

		expect(worker.fetched).toEqual([{ input: READER_URL, init: { cache: "no-cache" } }]);
		expect(worker.storedLabels()).toEqual({ [READER_KEY]: "copy of online reader" });
		expect(worker.storedSavedAt()).toEqual({ [READER_KEY]: SAVED_NOW });
		expect(worker.told).toEqual([
			{
				clientId: "asking-tab",
				message: { type: "readplace:reader-version", path: READER_PATH, version: "newer" },
			},
		]);
		expect(worker.storedWhenTold).toEqual([{ [READER_KEY]: "copy of online reader" }]);
	});

	it("answers that the copy on screen is current when the online reader carries the same article version, even as a page with another ETag", async () => {
		const worker = startWorker({
			fetch: async () => fakeResponse("online reader", { etag: ONLINE_ETAG, version: STORED_VERSION }),
		});

		await worker.dispatchMessage(revalidation).settled();

		expect(worker.told).toEqual([
			{
				clientId: "asking-tab",
				message: { type: "readplace:reader-version", path: READER_PATH, version: "same" },
			},
		]);
	});

	it.each([
		["a not-found page", fakeResponse("not found", { status: 404, version: ONLINE_VERSION })],
		["a redirect to sign in", fakeResponse("login", { redirected: true, version: ONLINE_VERSION })],
	])("answers nothing and keeps nothing when the reader comes back as %s", async (_name, response) => {
		const worker = startWorker({ fetch: async () => response });

		await worker.dispatchMessage(revalidation).settled();

		expect(worker.told).toEqual([]);
		expect(worker.storedLabels()).toEqual({});
	});

	it("answers nothing while the network is still unreachable", async () => {
		const worker = startWorker({ fetch: () => Promise.reject(NETWORK_DOWN) });

		await worker.dispatchMessage(revalidation).settled();

		expect(worker.told).toEqual([]);
		expect(worker.storedLabels()).toEqual({});
	});

	it.each([
		["a message of another kind", { type: "readplace:something-else", url: READER_URL }],
		["a revalidation of the listing", { ...revalidation, url: `${ORIGIN}/queue` }],
		["a revalidation of another origin's reader", { ...revalidation, url: "https://elsewhere.example/queue/abc123/view" }],
	])("leaves %s alone", (_name, data) => {
		const worker = startWorker({ fetch: neverFetched });

		const message = worker.dispatchMessage(data);

		expect(message.waited).toEqual([]);
		expect(worker.fetched).toEqual([]);
	});
});

describe("offline reader worker images", () => {
	const imageRequest = () => fakeRequest({ url: IMAGE_URL, mode: "no-cors", destination: "image" });

	it("fetches an image without credentials so the copy it keeps is readable, and serves it", async () => {
		const live = fakeResponse("live image", { contentType: "image/png" });
		const worker = startWorker({ fetch: async () => live });

		const event = worker.dispatchFetch(imageRequest(), { clientId: "open-tab" });

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.fetched).toEqual([{ input: IMAGE_URL, init: { mode: "cors", credentials: "omit" } }]);
		expect(worker.storedLabels()).toEqual({ [IMAGE_URL]: "copy of live image" });
		expect(worker.told).toEqual([]);
	});

	it("serves the stored image when the network is unreachable", async () => {
		const stored = fakeResponse("stored image", { contentType: "image/png", savedAt: SAVED_YESTERDAY });
		const worker = startWorker({
			fetch: () => Promise.reject(NETWORK_DOWN),
			cached: { [CACHE_NAME]: { [IMAGE_URL]: stored } },
		});

		const event = worker.dispatchFetch(imageRequest(), { clientId: "open-tab" });

		expect(await event.response()).toBe(stored);
		await event.settled();
		expect(worker.matchedWith).toEqual([{ ignoreVary: true }]);
		expect(worker.fetched).toHaveLength(1);
	});

	it("stops waiting for a slow image after three seconds and serves the stored one, refreshing it once the network answers", async () => {
		const stored = fakeResponse("stored image", { contentType: "image/png", savedAt: SAVED_YESTERDAY });
		const slow = deferred();
		const worker = startWorker({
			fetch: () => slow.promise,
			cached: { [CACHE_NAME]: { [IMAGE_URL]: stored } },
		});

		const event = worker.dispatchFetch(imageRequest(), { clientId: "open-tab" });
		expect(worker.timeouts.map((timeout) => timeout.ms)).toEqual([3000]);
		worker.timeouts[0].fire();

		expect(await event.response()).toBe(stored);
		slow.resolve(fakeResponse("late image", { contentType: "image/png" }));
		await event.settled();
		expect(worker.storedLabels()).toEqual({ [IMAGE_URL]: "copy of late image" });
	});

	it("keeps waiting for a slow image when nothing was stored, fetching it only once", async () => {
		const slow = deferred();
		const late = fakeResponse("late image", { contentType: "image/png" });
		const worker = startWorker({ fetch: () => slow.promise });

		const event = worker.dispatchFetch(imageRequest(), { clientId: "open-tab" });
		worker.timeouts[0].fire();
		await flush();
		slow.resolve(late);

		expect(await event.response()).toBe(late);
		await event.settled();
		expect(worker.fetched).toEqual([{ input: IMAGE_URL, init: { mode: "cors", credentials: "omit" } }]);
		expect(worker.storedLabels()).toEqual({ [IMAGE_URL]: "copy of late image" });
	});

	it("asks again the way the page did only once a slow image's credential-less fetch fails", async () => {
		const slow = deferred();
		const original = fakeResponse("original image", { contentType: "image/png" });
		const request = imageRequest();
		const worker = startWorker({
			fetch: (input) => (input === request ? Promise.resolve(original) : slow.promise),
		});

		const event = worker.dispatchFetch(request, { clientId: "open-tab" });
		worker.timeouts[0].fire();
		await flush();
		expect(worker.fetched).toHaveLength(1);
		slow.reject(NETWORK_DOWN);

		expect(await event.response()).toBe(original);
		await event.settled();
		expect(worker.fetched).toEqual([
			{ input: IMAGE_URL, init: { mode: "cors", credentials: "omit" } },
			{ input: request, init: undefined },
		]);
		expect(worker.storedLabels()).toEqual({});
	});

	it("dates the image it keeps with the time it saved it, replacing the image stored before", async () => {
		const live = fakeResponse("live image", { contentType: "image/png" });
		const worker = startWorker({
			fetch: async () => live,
			cached: {
				[CACHE_NAME]: {
					[IMAGE_URL]: fakeResponse("older image", { contentType: "image/png", savedAt: SAVED_YESTERDAY }),
				},
			},
		});

		const event = worker.dispatchFetch(imageRequest(), { clientId: "open-tab" });

		expect(await event.response()).toBe(live);
		await event.settled();
		expect(worker.storedLabels()).toEqual({ [IMAGE_URL]: "copy of live image" });
		expect(worker.storedSavedAt()).toEqual({ [IMAGE_URL]: SAVED_NOW });
	});

	it("never serves a stored image saved more than 30 days ago, deleting it and asking again the way the page did", async () => {
		const original = fakeResponse("original image", { contentType: "image/png" });
		const request = imageRequest();
		const worker = startWorker({
			fetch: (input) => (input === request ? Promise.resolve(original) : Promise.reject(NETWORK_DOWN)),
			cached: {
				[CACHE_NAME]: {
					[IMAGE_URL]: fakeResponse("expired image", { contentType: "image/png", savedAt: SAVED_31_DAYS_AGO }),
				},
			},
		});

		const event = worker.dispatchFetch(request, { clientId: "open-tab" });

		expect(await event.response()).toBe(original);
		await event.settled();
		expect(worker.storedLabels()).toEqual({});
	});

	it("loads an image from a host that refuses cross-origin reads the way the page asked for it, keeping nothing", async () => {
		const opaque = fakeResponse("opaque image", { status: 0, contentType: null });
		const request = imageRequest();
		const worker = startWorker({
			fetch: (input) => (input === request ? Promise.resolve(opaque) : Promise.reject(NETWORK_DOWN)),
		});

		const event = worker.dispatchFetch(request, { clientId: "open-tab" });

		expect(await event.response()).toBe(opaque);
		await event.settled();
		expect(worker.fetched).toEqual([
			{ input: IMAGE_URL, init: { mode: "cors", credentials: "omit" } },
			{ input: request, init: undefined },
		]);
		expect(worker.storedLabels()).toEqual({});
	});

	it.each([
		["refuses the credential-less request", 403],
		["has lost the image", 404],
	])("asks again the way the page did when the host %s, keeping nothing", async (_name, status) => {
		const refused = fakeResponse("refused image", { status, contentType: "text/plain" });
		const original = fakeResponse("original image", { status, contentType: "text/plain" });
		const request = imageRequest();
		const worker = startWorker({
			fetch: async (input) => (input === request ? original : refused),
			cached: { [CACHE_NAME]: { [IMAGE_URL]: fakeResponse("stored image") } },
		});

		const event = worker.dispatchFetch(request, { clientId: "open-tab" });

		expect(await event.response()).toBe(original);
		await event.settled();
		expect(worker.matchedWith).toEqual([]);
		expect(worker.storedLabels()).toEqual({ [IMAGE_URL]: "stored image" });
	});
});

describe("offline reader worker bundle", () => {
	it("hands its bundle the contract's stamp, so the worker dates its copies the way the download does", () => {
		expect(stampOfflineCopy).toBe(contractStamp);
	});
});
