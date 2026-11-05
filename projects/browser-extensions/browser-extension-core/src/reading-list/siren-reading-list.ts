import type { Logger } from "@packages/logger";
import type { ReadingListItem } from "../domain/reading-list-item.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { assert } from "../invariant";
import type { RefreshTokens } from "../auth/auth.types";
import type {
	CaptureTrigger,
	UploadContentResult,
	SaveUrl,
	UploadContent,
	InvokeAction,
	FindByUrl,
	GetItems,
	LoadPage,
	LoadSort,
	SavePages,
	CollectionTotal,
	LoadPageResult,
	CollectionPage,
	TabContent,
	PageDescriptor,
	SortDescriptor,
	SaveWarning,
	BulkSaveResult,
} from "./reading-list.types";
import {
	type PageEntry,
	type SortEntry,
	type SirenAction,
	resolveHref,
	UploadSlotResponseSchema,
	readSirenBody,
	SirenSubEntitySchema,
	SaveBlockedError,
	ItemGoneError,
} from "./siren-wire";
import type { NavigationResult, ArticleItem } from "./siren-navigation.types";
import { httpCacheable, createAuthorizedFetch } from "./siren-fetch";
import { toReadingListItem } from "./siren-items";
import {
	type OpenBulkSaveSession,
	advertisedLimit,
	arrayBufferToBase64,
	LEGACY_SERVER_BULK_LIMITS,
	REQUEST_ENVELOPE_RESERVE_BYTES,
	requestFor,
	degradeOversizedPages,
	packRequests,
} from "./bulk-save-packing";
import {
	groupOf,
	initSaveArticleUnderstanding,
	initSaveArticlesUnderstanding,
	initSaveContentUnderstanding,
	initListArticlesUnderstanding,
	NotSaveableError,
} from "./siren-understandings";
import { initExtension } from "./siren-walker";

/** Which advertised action produced a response, named after the action itself, so
 * a failure says which of the three legs ended the exchange. */
type UploadLeg = "save-content" | "upload-content" | "save-uploaded-content";

type UploadAttempt = { leg: UploadLeg; response: Response };

/** S3 answers a failed presigned PUT in the body (`SignatureDoesNotMatch`,
 * `RequestTimeTooSkewed`), which the status alone never shows. */
async function describeUpload(attempt: UploadAttempt): Promise<string> {
	const body = attempt.leg === "upload-content" ? ` ${await attempt.response.text()}` : "";
	return `${attempt.leg} failed: ${attempt.response.status}${body}`;
}

function appendCaptureTrigger(form: FormData, trigger: CaptureTrigger): void {
	form.append("captureTrigger", trigger);
}

/** A 4xx is a verdict on these exact bytes, so a deferred upload drops rather than
 * retrying or degrading onto a URL-only save — the link save already landed. */
async function classifyUpload(attempt: UploadAttempt): Promise<UploadContentResult> {
	if (attempt.response.ok) return { ok: true };
	if (attempt.response.status < 500) return { ok: false, reason: "rejected" };
	throw new Error(await describeUpload(attempt));
}

export interface SirenReadingListDeps {
	serverUrl: string;
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: (refusedAccessToken: string) => Promise<void>;
	refreshTokens: RefreshTokens;
	logger: Logger;
	onAdvertisedActions: (names: string[]) => void;
}

export function initSirenReadingList(deps: SirenReadingListDeps): {
	saveUrl: SaveUrl;
	uploadContent: UploadContent;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getItems: GetItems;
	loadPage: LoadPage;
	loadSort: LoadSort;
	savePages: SavePages;
	openBulkSaveSession: OpenBulkSaveSession;
} {
	const understandings = groupOf(
		initSaveArticleUnderstanding(),
		initSaveArticlesUnderstanding(),
		initSaveContentUnderstanding({ logger: deps.logger }),
		/** search carries its own `httpCacheable` ETag layer so the understanding is
		 * cacheable on its own terms, not by silently relying on the walker's
		 * navigation cache also seeing the GET. Both layers share one If-None-Match
		 * path, so a search GET passing through both stays correct. */
		httpCacheable(initListArticlesUnderstanding()),
	);
	const walk = initExtension(understandings, deps);

	const start = async (): Promise<NavigationResult> => {
		const collection = await walk();
		deps.onAdvertisedActions(Object.keys(collection.descriptors));
		return collection;
	};

	const knownItems = new Map<string, ArticleItem>();

	function trackItems(items: ArticleItem[]): void {
		for (const item of items) {
			knownItems.set(item.id, item);
		}
	}

	/** The one page of the list this instance is showing, with the page list the
	 * server served alongside it. `undefined` means nothing is loaded — a fresh
	 * instance, or one whose predecessor was torn down — which is why it is a
	 * separate state from "loaded, and there is only one page": the first cannot
	 * be answered at all. Nothing here is persisted, so no page href outlives the
	 * instance that was handed it. */
	type AdoptedCollection = {
		items: ArticleItem[];
		pages: PageEntry[];
		total: CollectionTotal | undefined;
		sorts: SortEntry[];
		followPage: (href: string) => Promise<NavigationResult>;
	};
	let current: AdoptedCollection | undefined;
	/** Bumped whenever a response is adopted or a page load starts, so a page that
	 * settles after something newer replaced the list can tell it is stale. */
	let requestSeq = 0;
	/** The page request already in flight, so one page is fetched at most once: a
	 * second request for the same page before the first settles is answered by it
	 * rather than fetched again. */
	let inFlight:
		| { href: string; ticket: number; promise: Promise<LoadPageResult> }
		| undefined;

	function toCollectionPage(adopted: AdoptedCollection): CollectionPage {
		/** The popup is handed labels and relations only — the server's opaque page
		 * hrefs stay here, so a page is asked for by position and the popup can
		 * neither build nor replay a URL. */
		return {
			items: adopted.items,
			pages: adopted.pages.map(({ label, rel }) => ({ label, rel })),
			total: adopted.total,
			sort: adopted.sorts.map(({ label, rel, order }) => ({ label, rel, order })),
		};
	}

	function adoptCollection(result: NavigationResult): CollectionPage {
		requestSeq += 1;
		current = {
			items: result.items,
			pages: result.pages,
			total: result.total,
			sorts: result.sorts,
			followPage: result.followPage,
		};
		return toCollectionPage(current);
	}

	function liveCollectionPage(): CollectionPage {
		assert(current, "a replaced list is still a loaded list");
		return toCollectionPage(current);
	}

	async function fetchPage(params: {
		adopted: AdoptedCollection;
		href: string;
		ticket: number;
	}): Promise<LoadPageResult> {
		let result: NavigationResult;
		try {
			result = await params.adopted.followPage(params.href);
		} catch (err) {
			/** An expired session is the caller's to handle — every other failure
			 * leaves the reader on the page they were already reading. */
			if (err instanceof UnauthorizedError) throw err;
			return liveCollectionPage();
		}
		/** Something newer landed while this page was in flight — a mutation's own
		 * answer, or a later page the reader clicked. That is the newer truth, so
		 * this page is dropped rather than shown over it. */
		if (params.ticket !== requestSeq) return liveCollectionPage();
		trackItems(result.items);
		return adoptCollection(result);
	}

	const getItems: GetItems = async () => {
		const collection = await start();
		trackItems(collection.items);
		return adoptCollection(collection);
	};

	function followHeld(params: { adopted: AdoptedCollection; href: string }): Promise<LoadPageResult> {
		if (inFlight?.href === params.href) return inFlight.promise;
		requestSeq += 1;
		const ticket = requestSeq;
		const pending = fetchPage({ adopted: params.adopted, href: params.href, ticket }).finally(() => {
			if (inFlight?.ticket === ticket) inFlight = undefined;
		});
		inFlight = { href: params.href, ticket, promise: pending };
		return pending;
	}

	const loadPage: LoadPage = async ({ index }) => {
		const adopted = current;
		if (!adopted) return { pageList: "lost" };
		const entry = adopted.pages[index];
		/** The page list moved under the click (or never had this entry): report it
		 * lost so the caller re-reads the list rather than rendering an empty page. */
		if (!entry) return { pageList: "lost" };
		return followHeld({ adopted, href: entry.href });
	};

	const loadSort: LoadSort = async ({ index }) => {
		const adopted = current;
		if (!adopted) return { pageList: "lost" };
		const entry = adopted.sorts[index];
		if (!entry) return { pageList: "lost" };
		return followHeld({ adopted, href: entry.href });
	};

	/** Runs the three legs of the presigned slot and hands back whichever
	 * response ended the exchange — the first refusal, or the completion — tagged
	 * with the leg that produced it, so each caller applies its own policy to a
	 * failure instead of one shared assert deciding for both. */
	async function uploadThroughSlot(params: {
		descriptor: SirenAction;
		url: string;
		title?: string;
		content: TabContent;
		trigger: CaptureTrigger;
	}): Promise<UploadAttempt> {
		const authFetch = createAuthorizedFetch(deps);

		const slotHref = resolveHref({ base: deps.serverUrl, href: params.descriptor.href });
		assert(slotHref, "save-content action href is not actionable");
		const slotForm = new FormData();
		slotForm.append("url", params.url);
		slotForm.append("mediaType", params.content.mediaType);
		slotForm.append("size", String(params.content.bytes.byteLength));
		if (params.title) slotForm.append("title", params.title);
		const slotResponse = await authFetch(slotHref, { method: params.descriptor.method, body: slotForm });
		if (!slotResponse.ok) return { leg: "save-content", response: slotResponse };
		const slot = UploadSlotResponseSchema.parse(await readSirenBody(slotResponse));
		const uploadAction = slot.actions.find((a) => a.name === "upload-content");
		const completeAction = slot.actions.find((a) => a.name === "save-uploaded-content");
		assert(uploadAction && completeAction, "upload-slot response missing its actions");

		const uploadHref = resolveHref({ base: deps.serverUrl, href: uploadAction.href });
		assert(uploadHref, "upload-content action href is not actionable");
		const putResponse = await deps.fetchFn(uploadHref, {
			method: uploadAction.method,
			headers: { "Content-Type": params.content.mediaType },
			body: params.content.bytes,
		});
		if (!putResponse.ok) return { leg: "upload-content", response: putResponse };

		const completeHref = resolveHref({ base: deps.serverUrl, href: completeAction.href });
		assert(completeHref, "save-uploaded-content action href is not actionable");
		assert(completeAction.fields, "completion action must declare fields");
		const completeForm = new FormData();
		for (const field of completeAction.fields) {
			if (field.value !== undefined) completeForm.append(field.name, String(field.value));
		}
		appendCaptureTrigger(completeForm, params.trigger);
		return {
			leg: "save-uploaded-content",
			response: await authFetch(completeHref, { method: completeAction.method, body: completeForm }),
		};
	}

	async function saveViaUploadSlot(params: {
		descriptor: SirenAction;
		url: string;
		title?: string;
		content: TabContent;
	}): Promise<ReadingListItem> {
		const attempt = await uploadThroughSlot({ ...params, trigger: "manual" });
		assert(attempt.response.ok, await describeUpload(attempt));
		return toReadingListItem(SirenSubEntitySchema.parse(await readSirenBody(attempt.response)), deps.serverUrl);
	}

	const saveUrl: SaveUrl = async ({ url, title, content }) => {
		const collection = await start();
		trackItems(collection.items);
		try {
			const saveContentAction = collection.actions["save-content"];
			const descriptor = collection.descriptors["save-content"];
			const maxBytes = advertisedLimit(descriptor, "content", "maxBytes");
			if (content && maxBytes !== undefined && content.bytes.byteLength > maxBytes) {
				assert(descriptor?.fields, "over-budget path implies a save-content descriptor with fields");
				const slotSupported = descriptor.fields.some((f) => f.name === "size");
				if (slotSupported) {
					try {
						const item = await saveViaUploadSlot({ descriptor, url, title, content });
						trackItems([{ ...item, boundActions: {} }]);
						return { ok: true, item, messages: [] };
					} catch (slotError) {
						deps.logger.warn(`Upload-slot save failed (${String(slotError)}) — saving URL-only`);
					}
				} else {
					deps.logger.warn(
						`Captured content of ${content.bytes.byteLength} bytes exceeds the advertised ${maxBytes}-byte upload limit — saving URL-only`,
					);
				}
			} else if (saveContentAction && content) {
				const fields: Record<string, string> = {
					url,
					mediaType: content.mediaType,
					contentBase64: arrayBufferToBase64(content.bytes),
				};
				if (title) fields.title = title;
				const result = await saveContentAction(fields);
				trackItems(result.items);
				return { ok: true, item: result.items[0], messages: result.messages };
			}
			const saveAction = collection.actions["save-article"];
			assert(
				saveAction,
				'Expected Siren action "save-article" not found in response',
			);
			const result = await saveAction({ url });
			trackItems(result.items);
			return { ok: true, item: result.items[0], messages: result.messages };
		} catch (err) {
			/** A save the server refused with messages (e.g. a locked account):
			 * surface them so the popup renders the warning and drops the user
			 * back into the list, rather than throwing a generic failure. */
			if (err instanceof SaveBlockedError) {
				return { ok: false, messages: err.messages };
			}
			if (err instanceof NotSaveableError) {
				trackItems(err.collection.items);
				const page = adoptCollection(err.collection);
				const failure: {
					ok: false;
					reason: "not-saveable";
					items: ReadingListItem[];
					pages: PageDescriptor[];
					total: CollectionTotal | undefined;
					sort: SortDescriptor[];
					warning?: SaveWarning;
				} = {
					ok: false,
					reason: "not-saveable",
					items: page.items,
					pages: page.pages,
					total: page.total,
					sort: page.sort,
				};
				if (err.warning) failure.warning = err.warning;
				return failure;
			}
			throw err;
		}
	};

	/** The entry point is walked fresh on every run: a job outlives the worker
	 * that queued it, and every href and presigned slot URL it could have
	 * carried would have expired by the time it wakes. */
	const uploadContent: UploadContent = async ({ url, title, content, trigger }) => {
		const collection = await start();
		const descriptor = collection.descriptors["save-content"];
		if (!descriptor) {
			deps.logger.warn(`Server advertises no save-content action — dropping the deferred upload of ${url}`);
			return { ok: false, reason: "unsupported" };
		}
		const maxBytes = advertisedLimit(descriptor, "content", "maxBytes");
		if (maxBytes !== undefined && content.bytes.byteLength > maxBytes) {
			const slotSupported = descriptor.fields?.some((field) => field.name === "size");
			if (!slotSupported) {
				deps.logger.warn(
					`Captured content of ${content.bytes.byteLength} bytes exceeds the advertised ${maxBytes}-byte upload limit and the server advertises no upload slot — dropping the deferred upload`,
				);
				return { ok: false, reason: "unsupported" };
			}
			return classifyUpload(await uploadThroughSlot({ descriptor, url, title, content, trigger }));
		}
		const actionUrl = resolveHref({ base: deps.serverUrl, href: descriptor.href });
		assert(actionUrl, "save-content action href is not actionable");
		const form = new FormData();
		form.append("url", url);
		form.append("mediaType", content.mediaType);
		if (title) form.append("title", title);
		appendCaptureTrigger(form, trigger);
		form.append("content", new Blob([content.bytes], { type: content.mediaType }), "content");
		const authFetch = createAuthorizedFetch(deps);
		return classifyUpload({
			leg: "save-content",
			response: await authFetch(actionUrl, { method: descriptor.method, body: form }),
		});
	};

	const invokeAction: InvokeAction = async ({ id, name }) => {
		let item = knownItems.get(id);
		if (!item) {
			const collection = await start();
			trackItems(collection.items);
			item = knownItems.get(id);
		}
		const boundAction = item?.boundActions[name];
		/** The item is gone (or never advertised this action): the server no
		 * longer offers it, so report not-found and let the popup re-render the
		 * fresh list rather than throwing a generic failure. */
		if (!boundAction) return { ok: false, reason: "not-found" };
		assert(item, "a bound action can only come from an item that advertised it");
		const targetUrl = item.url;
		try {
			const result = await boundAction();
			knownItems.clear();
			trackItems(result.items);
			/** The mutation answered with the collection itself, page list and all,
			 * so it becomes the whole of what is loaded. Keeping the page the reader
			 * was on would splice the article they just acted on back into view. */
			const page = adoptCollection(result);
			return { ok: true, items: page.items, pages: page.pages, total: page.total, sort: page.sort, targetUrl };
		} catch (err) {
			/** Any advertised action whose target 404s means the item is gone. The
			 * invoker throws a typed ItemGoneError, so not-found is detected by class
			 * rather than by regex-matching the error message. */
			if (err instanceof ItemGoneError) {
				return { ok: false, reason: "not-found" };
			}
			throw err;
		}
	};

	const findByUrl: FindByUrl = async (url) => {
		const collection = await start();
		trackItems(collection.items);
		const filterAction = collection.actions.search;
		assert(
			filterAction,
			'Expected Siren action "search" not found in response',
		);
		const result = await filterAction({ url });
		trackItems(result.items);
		const found = result.items[0];
		return found ?? null;
	};

	const openBulkSaveSession: OpenBulkSaveSession = async () => {
		const collection = await start();
		const action = collection.actions["save-articles"];
		assert(
			action,
			'Expected Siren action "save-articles" not found in response',
		);
		const descriptor = collection.descriptors["save-articles"];
		const maxBytes = advertisedLimit(descriptor, "content", "maxBytes") ?? LEGACY_SERVER_BULK_LIMITS.maxBytes;
		const maxItems = advertisedLimit(descriptor, "manifest", "maxItems") ?? LEGACY_SERVER_BULK_LIMITS.maxItems;
		const maxRequestBytes =
			advertisedLimit(descriptor, "content", "maxRequestBytes") ?? LEGACY_SERVER_BULK_LIMITS.maxRequestBytes;
		return {
			limits: {
				maxItems,
				maxBytes,
				requestBudget: maxRequestBytes - REQUEST_ENVELOPE_RESERVE_BYTES,
			},
			sendChunk: async (pages) => {
				const result = await action(requestFor(pages));
				assert(result.bulk, "save-articles response missing bulk summary");
				return result.bulk;
			},
		};
	};

	const savePages: SavePages = async ({ pages }) => {
		const summary: BulkSaveResult = {
			saved: 0,
			queued: 0,
			skipped: 0,
			failed: 0,
			tooBig: [],
			skippedUrls: [],
			failedUrls: [],
			alreadySaved: 0,
			pendingRetry: 0,
			unauthorized: false,
		};
		if (pages.length === 0) return summary;

		const session = await openBulkSaveSession();
		const degraded = degradeOversizedPages({ pages, limits: session.limits, logger: deps.logger });
		summary.tooBig.push(...degraded.tooBig);

		const requests = packRequests(degraded.pages, {
			maxItems: session.limits.maxItems,
			maxBytes: Math.min(session.limits.maxBytes, session.limits.requestBudget),
		});
		for (const [i, request] of requests.entries()) {
			try {
				const bulk = await session.sendChunk(request);
				const results = bulk.results ?? [];
				summary.saved += bulk.saved - bulk.queued;
				summary.queued += bulk.queued;
				summary.skipped += bulk.skipped;
				summary.failed += bulk.failed;
				summary.tooBig.push(...bulk.tooBig);
				summary.skippedUrls.push(...bulk.skippedUrls);
				summary.alreadySaved += results.filter((entry) => entry.outcome === "merged").length;
				summary.failedUrls.push(
					...results.filter((entry) => entry.outcome === "failed").map((entry) => ({ url: entry.url })),
				);
				const accounted = bulk.saved + bulk.skipped + bulk.failed;
				const shortfall = request.length - accounted;
				if (shortfall > 0) {
					const accountedUrls = new Set(results.map((entry) => entry.url));
					summary.failed += shortfall;
					summary.failedUrls.push(
						...request
							.filter((page) => !accountedUrls.has(page.url))
							.map((page) => ({ url: page.url })),
					);
				}
			} catch (err) {
				if (err instanceof UnauthorizedError) {
					if (i === 0) throw err;
					const unsent = requests.slice(i).flat();
					summary.failed += unsent.length;
					summary.failedUrls.push(...unsent.map((page) => ({ url: page.url })));
					summary.unauthorized = true;
					return summary;
				}
				summary.failed += request.length;
				summary.failedUrls.push(...request.map((page) => ({ url: page.url })));
			}
		}
		return summary;
	};

	return { saveUrl, uploadContent, invokeAction, findByUrl, getItems, loadPage, loadSort, savePages, openBulkSaveSession };
}
