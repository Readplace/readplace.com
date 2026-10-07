import {
	ARTICLE_VERSION_HEADER,
	OFFLINE_CACHE_NAME,
	OFFLINE_CACHE_PREFIX,
	OFFLINE_SAVED_AT_HEADER,
	type OfflinePageKind,
	READER_SOURCE,
	READER_SOURCE_MESSAGE_TYPE,
	READER_VERSION,
	READER_VERSION_MESSAGE_TYPE,
	REVALIDATE_READER_MESSAGE_TYPE,
	type ReaderSource,
	type ReaderSourceMessage,
	type ReaderVersionMessage,
	isFreshOfflineCopy,
	offlineCacheKey,
	offlinePageKind,
} from "./offline-cache";
import { initOfflineOwnership } from "./offline-owner";

export { offlineOwnerMarker, stampOfflineCopy } from "./offline-cache";

interface WorkerHeaders {
	get(name: string): string | null;
}

interface WorkerRequest {
	url: string;
	method: string;
	mode: string;
	destination: string;
	headers: WorkerHeaders;
}

interface WorkerResponse {
	ok: boolean;
	status: number;
	redirected: boolean;
	headers: WorkerHeaders;
	clone(): WorkerResponse;
}

interface WorkerCache {
	match(key: string, options: { ignoreVary: true }): Promise<WorkerResponse | undefined>;
	put(key: string, response: WorkerResponse): Promise<void>;
	delete(key: string): Promise<boolean>;
	keys(): Promise<ReadonlyArray<{ url: string }>>;
}

interface WorkerLifecycleEvent {
	waitUntil(work: Promise<unknown>): void;
}

interface WorkerFetchEvent extends WorkerLifecycleEvent {
	request: WorkerRequest;
	clientId: string;
	resultingClientId: string;
	preloadResponse: Promise<WorkerResponse | undefined> | undefined;
	respondWith(response: Promise<WorkerResponse>): void;
}

interface ReaderTab {
	postMessage(message: ReaderSourceMessage | ReaderVersionMessage): void;
}

interface WorkerMessageEvent extends WorkerLifecycleEvent {
	data: unknown;
	source: ReaderTab;
}

export interface OfflineReaderWorkerDeps {
	origin: string;
	skipWaiting: () => Promise<void>;
	claimClients: () => Promise<void>;
	findClient: (id: string) => Promise<ReaderTab | undefined>;
	navigationPreload: { enable(): Promise<void> } | undefined;
	addInstallListener: (listener: (event: WorkerLifecycleEvent) => void) => void;
	addActivateListener: (listener: (event: WorkerLifecycleEvent) => void) => void;
	addFetchListener: (listener: (event: WorkerFetchEvent) => void) => void;
	addMessageListener: (listener: (event: WorkerMessageEvent) => void) => void;
	caches: {
		open(name: string): Promise<WorkerCache>;
		keys(): Promise<string[]>;
		delete(name: string): Promise<boolean>;
	};
	fetchFn: (
		input: WorkerRequest | string,
		init?: { mode: "cors"; credentials: "omit" } | { cache: "no-cache" },
	) => Promise<WorkerResponse>;
	now: () => number;
	stampCopy: (response: WorkerResponse, savedAt: number) => WorkerResponse;
	markOwner: (answer: WorkerResponse, savedAt: number) => WorkerResponse;
}

interface ServedPage {
	response: WorkerResponse;
	source: ReaderSource | undefined;
}

interface RequestedPage {
	key: string;
	path: string;
}

function read(value: unknown, name: string): unknown {
	return Reflect.get(Object(value), name);
}

export function initOfflineReaderWorker(deps: OfflineReaderWorkerDeps): void {
	const { caches } = deps;
	const ownership = initOfflineOwnership<WorkerResponse>({
		origin: deps.origin,
		now: deps.now,
		markOwner: deps.markOwner,
	});

	async function freshCopy(cache: WorkerCache, key: string): Promise<WorkerResponse | undefined> {
		const copy = await cache.match(key, { ignoreVary: true });
		if (copy === undefined || isFreshOfflineCopy(copy, deps.now())) return copy;
		await cache.delete(key);
		return undefined;
	}

	async function storedPage(key: string): Promise<WorkerResponse | undefined> {
		const cache = await caches.open(OFFLINE_CACHE_NAME);
		const owner = await ownership.confirmedOwner(cache);
		if (owner === undefined) return undefined;
		const copy = await freshCopy(cache, key);
		return copy !== undefined && ownership.isOwnedBy(copy, owner) ? copy : undefined;
	}

	async function storedImage(key: string): Promise<WorkerResponse | undefined> {
		const cache = await caches.open(OFFLINE_CACHE_NAME);
		if ((await ownership.confirmedOwner(cache)) === undefined) return undefined;
		return freshCopy(cache, key);
	}

	async function keep(key: string, copy: WorkerResponse): Promise<void> {
		const cache = await caches.open(OFFLINE_CACHE_NAME);
		await cache.put(key, deps.stampCopy(copy, deps.now()));
	}

	async function keepAnswer(input: {
		key: string;
		answer: WorkerResponse;
		copy: WorkerResponse | undefined;
	}): Promise<void> {
		await ownership.adopt(await caches.open(OFFLINE_CACHE_NAME), input.answer);
		if (input.copy !== undefined) await keep(input.key, input.copy);
	}

	async function sweepExpiredCopies(): Promise<void> {
		const cache = await caches.open(OFFLINE_CACHE_NAME);
		await ownership.confirmedOwner(cache);
		for (const entry of await cache.keys()) await freshCopy(cache, entry.url);
	}

	function isFullPage(response: WorkerResponse): boolean {
		return (
			response.status === 200 &&
			!response.redirected &&
			String(response.headers.get("Content-Type")).startsWith("text/html")
		);
	}

	function fromNetwork(response: WorkerResponse): ServedPage {
		return { response, source: isFullPage(response) ? READER_SOURCE.network : undefined };
	}

	async function servePage(key: string, network: Promise<WorkerResponse>): Promise<ServedPage> {
		try {
			return fromNetwork(await network);
		} catch (unreachable) {
			const stored = await storedPage(key);
			if (stored === undefined) throw unreachable;
			return { response: stored, source: READER_SOURCE.offlineCopy };
		}
	}

	function versionMessage(input: {
		path: string;
		onScreen: unknown;
		online: WorkerResponse;
	}): ReaderVersionMessage {
		return {
			type: READER_VERSION_MESSAGE_TYPE,
			path: input.path,
			version:
				input.online.headers.get(ARTICLE_VERSION_HEADER) === input.onScreen
					? READER_VERSION.same
					: READER_VERSION.newer,
		};
	}

	async function tellClient(input: {
		event: WorkerFetchEvent;
		requested: RequestedPage;
		served: ServedPage;
	}): Promise<void> {
		const { requested, served } = input;
		if (served.source === undefined) return;
		const client = await deps.findClient(input.event.resultingClientId || input.event.clientId);
		if (client === undefined) return;
		if (served.source === READER_SOURCE.network) {
			client.postMessage({ type: READER_SOURCE_MESSAGE_TYPE, source: served.source, path: requested.path });
			return;
		}
		client.postMessage({
			type: READER_SOURCE_MESSAGE_TYPE,
			source: served.source,
			path: requested.path,
			savedAt: String(served.response.headers.get(OFFLINE_SAVED_AT_HEADER)),
			version: served.response.headers.get(ARTICLE_VERSION_HEADER),
		});
	}

	function respondWithPage(event: WorkerFetchEvent, requested: RequestedPage): void {
		const network = Promise.resolve(event.preloadResponse).then(
			(preloaded) => preloaded ?? deps.fetchFn(event.request),
		);
		const stored = network.then((answer) =>
			keepAnswer({ key: requested.key, answer, copy: isFullPage(answer) ? answer.clone() : undefined }),
		);
		const served = servePage(requested.key, network);
		event.respondWith(served.then((page) => page.response));
		event.waitUntil(
			Promise.allSettled([stored, served.then((page) => tellClient({ event, requested, served: page }))]),
		);
	}

	async function revalidate(input: { client: ReaderTab; url: URL; onScreen: unknown }): Promise<void> {
		const online = await deps.fetchFn(input.url.href, { cache: "no-cache" });
		const copy = isFullPage(online) ? online.clone() : undefined;
		await keepAnswer({ key: offlineCacheKey(input.url), answer: online, copy });
		if (copy === undefined) return;
		input.client.postMessage(versionMessage({ path: input.url.pathname, onScreen: input.onScreen, online }));
	}

	async function serveImage(
		request: WorkerRequest,
		network: Promise<WorkerResponse>,
	): Promise<WorkerResponse> {
		const answer = await network.catch(() => undefined);
		if (answer === undefined) return (await storedImage(request.url)) ?? deps.fetchFn(request);
		return answer.ok ? answer : deps.fetchFn(request);
	}

	function respondWithImage(event: WorkerFetchEvent): void {
		const { url } = event.request;
		const network = deps.fetchFn(url, { mode: "cors", credentials: "omit" });
		const stored = network.then((response) =>
			response.ok ? keep(url, response.clone()) : undefined,
		);
		event.respondWith(serveImage(event.request, network));
		event.waitUntil(Promise.allSettled([stored]));
	}

	function pageKind(url: URL): OfflinePageKind | undefined {
		return url.origin === deps.origin ? offlinePageKind(url) : undefined;
	}

	function requestedPage(request: WorkerRequest): RequestedPage | undefined {
		if (request.mode !== "navigate" && request.headers.get("HX-Boosted") !== "true") return undefined;
		const url = new URL(request.url);
		if (pageKind(url) === undefined) return undefined;
		return { key: offlineCacheKey(url), path: url.pathname };
	}

	async function activate(): Promise<void> {
		const names = await caches.keys();
		const outdated = names.filter(
			(name) => name.startsWith(OFFLINE_CACHE_PREFIX) && name !== OFFLINE_CACHE_NAME,
		);
		await Promise.all(outdated.map((name) => caches.delete(name)));
		await sweepExpiredCopies();
		await deps.navigationPreload?.enable();
		await deps.claimClients();
	}

	deps.addInstallListener((event) => {
		event.waitUntil(deps.skipWaiting());
	});

	deps.addActivateListener((event) => {
		event.waitUntil(activate());
	});

	deps.addFetchListener((event) => {
		const { request } = event;
		if (request.method !== "GET") return;
		if (request.destination === "image") {
			respondWithImage(event);
			return;
		}
		const requested = requestedPage(request);
		if (requested !== undefined) respondWithPage(event, requested);
	});

	deps.addMessageListener((event) => {
		if (read(event.data, "type") !== REVALIDATE_READER_MESSAGE_TYPE) return;
		const url = new URL(String(read(event.data, "url")));
		if (pageKind(url) !== "reader") return;
		event.waitUntil(
			Promise.allSettled([revalidate({ client: event.source, url, onScreen: read(event.data, "version") })]),
		);
	});
}
