import "../zod-config";
import { z } from "zod";
import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type {
	FindByUrl,
	GetAllItems,
	RemoveUrl,
	SaveUrl,
	SaveWarning,
} from "./reading-list.types";

const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

// Cannot use node:assert in browser bundles — this minimal assert
// provides the same asserts-value narrowing for runtime invariants.
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Thrown when the server rejects a save by returning the current collection
 * (e.g. for non-saveable URL schemes). Carries the items so the caller can
 * drop the user back into the list view without a re-fetch. The optional
 * `warning` mirrors `properties.warning` on the Siren collection so the popup
 * can surface a human-readable reason next to the list. */
class NotSaveableError extends Error {
	constructor(
		public readonly items: ReadingListItem[],
		public readonly warning?: SaveWarning,
	) {
		super("URL not saveable");
	}
}

const SirenPropertiesSchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string(),
	savedAt: z.string(),
});

const SirenLinkSchema = z.object({
	rel: z.array(z.string()),
	href: z.string(),
});

const SirenActionSchema = z.object({
	name: z.string(),
	href: z.string(),
	method: z.string(),
	type: z.string().optional(),
	fields: z
		.array(z.object({ name: z.string(), type: z.string() }))
		.optional(),
});

const SirenSubEntitySchema = z.object({
	properties: z.record(z.string(), z.unknown()).optional(),
	links: z.array(SirenLinkSchema).optional(),
	actions: z.array(SirenActionSchema).optional(),
});

const SirenErrorSchema = z.object({
	class: z.array(z.string()).optional(),
	properties: z.object({
		code: z.string(),
		message: z.string(),
	}),
	actions: z.array(SirenActionSchema).optional(),
});

type SirenAction = z.infer<typeof SirenActionSchema>;
type SirenSubEntity = z.infer<typeof SirenSubEntitySchema>;

const SirenWarningSchema = z.object({
	code: z.string(),
	message: z.string(),
});

const SirenCollectionResponseSchema = z.object({
	class: z.array(z.string()).optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	entities: z.array(SirenSubEntitySchema).optional(),
	links: z.array(SirenLinkSchema).optional(),
	actions: z.array(SirenActionSchema).optional(),
});

function extractCollectionWarning(
	body: SirenCollectionResponse,
): SaveWarning | undefined {
	const warning = body.properties?.warning;
	if (warning === undefined) return undefined;
	const parsed = SirenWarningSchema.safeParse(warning);
	return parsed.success ? parsed.data : undefined;
}

type SirenCollectionResponse = z.infer<typeof SirenCollectionResponseSchema>;

type DoFetchInit = Omit<RequestInit, "headers"> & {
	headers?: Record<string, string>;
};

type DoFetch = (url: string, init?: DoFetchInit) => Promise<Response>;

type ActionContext = {
	serverUrl: string;
	doFetch: DoFetch;
	resolveItem: (entity: SirenSubEntity) => ArticleItem;
	parseCollection: (body: SirenCollectionResponse) => NavigationResult;
};

type ActionHandler = (
	sirenAction: SirenAction,
	context: ActionContext,
) => BoundAction;

export type BoundAction = (
	fields?: Record<string, string>,
) => Promise<NavigationResult>;

export type NavigationResult = {
	items: ArticleItem[];
	actions: Record<string, BoundAction>;
};

export type ArticleItem = ReadingListItem & {
	actions: Record<string, BoundAction>;
};

function findLinkHref(entity: SirenSubEntity, rel: string): string | undefined {
	return entity.links?.find((link) => link.rel.includes(rel))?.href; /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range inside ?.find()?. chained optionals (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
}

function toReadingListItem(
	entity: SirenSubEntity,
	serverUrl: string,
): ReadingListItem {
	assert(entity.properties, "Server response entity missing properties");
	const props = SirenPropertiesSchema.parse(entity.properties);
	const readHref = findLinkHref(entity, "read");
	return {
		id: props.id as ReadingListItemId,
		url: props.url,
		title: props.title,
		savedAt: new Date(props.savedAt),
		readUrl: readHref ? `${serverUrl}${readHref}` : undefined,
	};
}

export function initSaveArticleUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-article", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.url, "save-article requires a url field");
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					headers: {
						"Content-Type": sirenAction.type ?? "application/json",
						/** Signal that the client will process a representation in
						 * the response (RFC 7240). */
						Prefer: "return=representation",
					},
					body: JSON.stringify({ url: fields.url }),
				},
			);
			if (!response.ok) {
				/** Server may reject a save by returning the current collection
				 * (e.g. non-saveable URL scheme). Surface those items via
				 * NotSaveableError so saveUrl can drop the user back into the list,
				 * plus the optional `properties.warning` so the popup can render
				 * a banner explaining why nothing was saved. */
				const body = await response.json().catch(() => null);
				const collection = SirenCollectionResponseSchema.safeParse(body);
				if (collection.success && collection.data.class?.includes("collection")) {
					throw new NotSaveableError(
						context.parseCollection(collection.data).items,
						extractCollectionWarning(collection.data),
					);
				}
				throw new Error(`Save failed: ${response.status}`);
			}
			const body = SirenSubEntitySchema.parse(await response.json());
			const item = context.resolveItem(body);
			return { items: [item], actions: {} };
		};
	});
	return handlers;
}

export function initSaveHtmlUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-html", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.url, "save-html requires a url field");
			assert(fields?.rawHtml, "save-html requires a rawHtml field");
			const body: Record<string, string> = {
				url: fields.url,
				rawHtml: fields.rawHtml,
			};
			if (fields.title) body.title = fields.title;
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					headers: {
						"Content-Type": sirenAction.type ?? "application/json",
					},
					body: JSON.stringify(body),
				},
			);
			if (!response.ok) {
				/** The server may carry a fallback action inside a Siren error body — follow it with {url, title} (dropping rawHtml) to degrade onto the URL-only save path. */
				const errorJson = await response.json().catch(() => null);
				const errorParsed = SirenErrorSchema.safeParse(errorJson);
				if (!errorParsed.success) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const errorActions = errorParsed.data.actions;
				if (errorActions === undefined) {
					throw new Error(`Save failed: ${response.status}`);
				}
				if (errorActions.length === 0) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const fallbackAction = errorActions[0];
				console.warn(errorParsed.data.properties.message);
				const fallbackBody: Record<string, string> = { url: fields.url };
				if (fields.title) fallbackBody.title = fields.title;
				const fallbackContentType = fallbackAction.type === undefined
					? "application/json"
					: fallbackAction.type;
				const fallbackResponse = await context.doFetch(
					`${context.serverUrl}${fallbackAction.href}`,
					{
						method: fallbackAction.method,
						headers: { "Content-Type": fallbackContentType },
						body: JSON.stringify(fallbackBody),
					},
				);
				assert(
					fallbackResponse.ok,
					`Save failed: ${fallbackResponse.status}`,
				);
				const fallbackResponseBody = SirenSubEntitySchema.parse(
					await fallbackResponse.json(),
				);
				const fallbackItem = context.resolveItem(fallbackResponseBody);
				return { items: [fallbackItem], actions: {} };
			}
			const responseBody = SirenSubEntitySchema.parse(await response.json());
			const item = context.resolveItem(responseBody);
			return { items: [item], actions: {} };
		};
	});
	return handlers;
}

export function initSavePdfUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-pdf", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.url, "save-pdf requires a url field");
			assert(fields?.pdfBytes, "save-pdf requires a pdfBytes field");
			/** The harness passes `pdfBytes` through the same string-keyed
			 * `fields` map as other actions. We carry it as a base64 string
			 * because FormData expects Blob/string parts and ArrayBuffers don't
			 * survive a JSON round-trip — the caller serialises and we decode
			 * here, so the FormData receives a Blob with the original bytes. */
			const binaryString = atob(fields.pdfBytes);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i += 1) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			const formData = new FormData();
			formData.append("url", fields.url);
			formData.append(
				"pdf",
				new Blob([bytes], { type: "application/pdf" }),
				"capture.pdf",
			);
			/** Do not set Content-Type explicitly — the FormData runtime
			 * (browser or undici) generates the multipart boundary and appends it
			 * to the header for us. Setting it manually here would either omit
			 * the boundary or duplicate it. */
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					body: formData,
				},
			);
			if (!response.ok) {
				/** The server may carry a fallback `save-article` action inside a
				 * Siren error body — follow it with just `url` (dropping pdfBytes)
				 * to degrade onto the URL-only save path. Mirrors the
				 * save-html oversize handler. */
				const errorJson = await response.json().catch(() => null);
				const errorParsed = SirenErrorSchema.safeParse(errorJson);
				if (!errorParsed.success) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const errorActions = errorParsed.data.actions;
				if (errorActions === undefined) {
					throw new Error(`Save failed: ${response.status}`);
				}
				if (errorActions.length === 0) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const fallbackAction = errorActions[0];
				console.warn(errorParsed.data.properties.message);
				const fallbackBody: Record<string, string> = { url: fields.url };
				const fallbackContentType = fallbackAction.type === undefined
					? "application/json"
					: fallbackAction.type;
				const fallbackResponse = await context.doFetch(
					`${context.serverUrl}${fallbackAction.href}`,
					{
						method: fallbackAction.method,
						headers: { "Content-Type": fallbackContentType },
						body: JSON.stringify(fallbackBody),
					},
				);
				assert(
					fallbackResponse.ok,
					`Save failed: ${fallbackResponse.status}`,
				);
				const fallbackResponseBody = SirenSubEntitySchema.parse(
					await fallbackResponse.json(),
				);
				const fallbackItem = context.resolveItem(fallbackResponseBody);
				return { items: [fallbackItem], actions: {} };
			}
			const responseBody = SirenSubEntitySchema.parse(await response.json());
			const item = context.resolveItem(responseBody);
			return { items: [item], actions: {} };
		};
	});
	return handlers;
}

export function initSaveContentUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-content", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.url, "save-content requires a url field");
			assert(fields?.mediaType, "save-content requires a mediaType field");
			const formData = new FormData();
			formData.append("url", fields.url);
			formData.append("mediaType", fields.mediaType);
			if (fields.title) formData.append("title", fields.title);
			if (fields.contentBase64) {
				const binaryString = atob(fields.contentBase64);
				const bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i += 1) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				formData.append(
					"content",
					new Blob([bytes], { type: fields.mediaType }),
					"content",
				);
			} else {
				assert(fields.rawHtml, "save-content requires either contentBase64 or rawHtml");
				formData.append(
					"content",
					new Blob([fields.rawHtml], { type: "text/html" }),
					"content.html",
				);
			}
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					body: formData,
				},
			);
			if (!response.ok) {
				const errorJson = await response.json().catch(() => null);
				const errorParsed = SirenErrorSchema.safeParse(errorJson);
				if (!errorParsed.success) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const errorActions = errorParsed.data.actions;
				if (errorActions === undefined) {
					throw new Error(`Save failed: ${response.status}`);
				}
				if (errorActions.length === 0) {
					throw new Error(`Save failed: ${response.status}`);
				}
				const fallbackAction = errorActions[0];
				console.warn(errorParsed.data.properties.message);
				const fallbackBody: Record<string, string> = { url: fields.url };
				if (fields.title) fallbackBody.title = fields.title;
				const fallbackContentType = fallbackAction.type === undefined
					? "application/json"
					: fallbackAction.type;
				const fallbackResponse = await context.doFetch(
					`${context.serverUrl}${fallbackAction.href}`,
					{
						method: fallbackAction.method,
						headers: { "Content-Type": fallbackContentType },
						body: JSON.stringify(fallbackBody),
					},
				);
				assert(
					fallbackResponse.ok,
					`Save failed: ${fallbackResponse.status}`,
				);
				const fallbackResponseBody = SirenSubEntitySchema.parse(
					await fallbackResponse.json(),
				);
				const fallbackItem = context.resolveItem(fallbackResponseBody);
				return { items: [fallbackItem], actions: {} };
			}
			const responseBody = SirenSubEntitySchema.parse(await response.json());
			const item = context.resolveItem(responseBody);
			return { items: [item], actions: {} };
		};
	});
	return handlers;
}

export function initDeleteArticleUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("delete", (sirenAction, context) => {
		return async () => {
			/** Signal that the client will process a representation in the
			 * response (RFC 7240). */
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					headers: { Prefer: "return=representation" },
				},
			);
			assert(response.ok, `Delete failed: ${response.status}`);
			const body = SirenCollectionResponseSchema.parse(await response.json());
			return context.parseCollection(body);
		};
	});
	return handlers;
}

export function initListArticlesUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("search", (sirenAction, context) => {
		return async (fields) => {
			const filterUrl = new URL(
				`${context.serverUrl}${sirenAction.href}`,
			);
			if (fields?.url) filterUrl.searchParams.set("url", fields.url);
			if (fields?.status)
				filterUrl.searchParams.set("status", fields.status);
			const response = await context.doFetch(filterUrl.toString(), {
				method: sirenAction.method,
			});
			if (!response.ok) return { items: [], actions: {} };
			const body = SirenCollectionResponseSchema.parse(await response.json());
			const items = (body.entities ?? []).map((e) =>
				context.resolveItem(e),
			);
			return { items, actions: {} };
		};
	});
	return handlers;
}

export function groupOf(
	...groups: Map<string, ActionHandler>[]
): Map<string, ActionHandler> {
	const combined = new Map<string, ActionHandler>();
	for (const group of groups) {
		for (const [key, handler] of group) {
			assert(!combined.has(key), `Duplicate action handler: ${key}`);
			combined.set(key, handler);
		}
	}
	return combined;
}

function createCachingFetch(
	cache: Map<string, { etag: string; body: unknown }>,
	original: DoFetch,
): DoFetch {
	return async (url, init) => {
		if (init?.method && init.method.toUpperCase() !== "GET")
			return original(url, init);

		const headers: Record<string, string> = { ...(init?.headers ?? {}) };
		const cached = cache.get(url);
		if (cached) headers["If-None-Match"] = cached.etag;

		const response = await original(url, { ...init, headers });

		if (response.status === 304 && cached) {
			return new Response(JSON.stringify(cached.body), {
				status: 200,
				headers: { "Content-Type": SIREN_MEDIA_TYPE },
			});
		}

		if (response.ok) {
			const etag = response.headers.get("etag");
			if (etag) {
				const clone = response.clone();
				cache.set(url, { etag, body: await clone.json() });
			}
		}

		return response;
	};
}

export function httpCacheable(
	understanding: Map<string, ActionHandler>,
): Map<string, ActionHandler> {
	const cache = new Map<string, { etag: string; body: unknown }>();

	const wrapped = new Map<string, ActionHandler>();
	for (const [name, handler] of understanding) {
		wrapped.set(name, (sirenAction, context) => {
			return handler(sirenAction, {
				...context,
				doFetch: createCachingFetch(cache, context.doFetch),
			});
		});
	}
	return wrapped;
}

export interface ExtensionDeps {
	serverUrl: string;
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: () => Promise<void>;
}

const ENTRY_POINT = "/";

export function initExtension(
	handlers: Map<string, ActionHandler>,
	deps: ExtensionDeps,
): () => Promise<NavigationResult> {
	let resolvedUrl: string | null = null;
	const navigationCache = new Map<
		string,
		{ etag: string; body: unknown }
	>();

	function createDoFetch(): DoFetch {
		return async (url, init) => {
			const token = await deps.getAccessToken();
			assert(token, "No access token available");
			const headers: Record<string, string> = {
				Authorization: `Bearer ${token}`,
				Accept: SIREN_MEDIA_TYPE,
				...init?.headers,
			};
			const response = await deps.fetchFn(url, { ...init, headers });
			if (response.status === 401) {
				await deps.onUnauthorized();
				throw new UnauthorizedError();
			}
			return response;
		};
	}

	function createActionContext(doFetch: DoFetch): ActionContext {
		return {
			serverUrl: deps.serverUrl,
			doFetch,
			resolveItem: (e) => resolveItem(e, doFetch),
			parseCollection: (body) => parseResponse(body, doFetch),
		};
	}

	function resolveItem(
		entity: SirenSubEntity,
		doFetch: DoFetch,
	): ArticleItem {
		const item = toReadingListItem(entity, deps.serverUrl);
		const itemActions: Record<string, BoundAction> = {};
		const context = createActionContext(doFetch);
		for (const sirenAction of entity.actions ?? []) {
			const handler = handlers.get(sirenAction.name);
			if (handler) {
				itemActions[sirenAction.name] = handler(sirenAction, context);
			}
		}
		return { ...item, actions: itemActions };
	}

	function bindCollectionActions(
		sirenActions: SirenAction[],
		doFetch: DoFetch,
	): Record<string, BoundAction> {
		const bound: Record<string, BoundAction> = {};
		const context = createActionContext(doFetch);
		for (const sirenAction of sirenActions) {
			const handler = handlers.get(sirenAction.name);
			if (handler) {
				bound[sirenAction.name] = handler(sirenAction, context);
			}
		}
		return bound;
	}

	function parseResponse(
		body: SirenCollectionResponse,
		doFetch: DoFetch,
	): NavigationResult {
		const items = (body.entities ?? []).map((e) => resolveItem(e, doFetch));
		const actions = bindCollectionActions(body.actions ?? [], doFetch);
		return { items, actions };
	}

	return async () => {
		const doFetch = createCachingFetch(navigationCache, createDoFetch());

		const targetUrl = resolvedUrl ?? `${deps.serverUrl}${ENTRY_POINT}`;
		const response = await doFetch(targetUrl, { method: "GET" });
		assert(response.ok, `Navigation failed: ${response.status}`);

		const body = SirenCollectionResponseSchema.parse(await response.json());

		if (!resolvedUrl) {
			const selfLink = body.links?.find((l) => l.rel.includes("self"));
			assert(selfLink, "Collection response missing self link");
			resolvedUrl = selfLink.href.startsWith("/")
				? `${deps.serverUrl}${selfLink.href}`
				: selfLink.href;

			const cachedEntry = navigationCache.get(targetUrl);
			if (cachedEntry && resolvedUrl !== targetUrl) {
				navigationCache.set(resolvedUrl, cachedEntry);
			}
		}

		return parseResponse(body, doFetch);
	};
}

export interface SirenReadingListDeps {
	serverUrl: string;
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: () => Promise<void>;
}

export function initSirenReadingList(deps: SirenReadingListDeps): {
	saveUrl: SaveUrl;
	removeUrl: RemoveUrl;
	findByUrl: FindByUrl;
	getAllItems: GetAllItems;
} {
	const understandings = groupOf(
		initSaveArticleUnderstanding(),
		initSaveHtmlUnderstanding(),
		initSavePdfUnderstanding(),
		initSaveContentUnderstanding(),
		initDeleteArticleUnderstanding(),
		httpCacheable(initListArticlesUnderstanding()),
	);
	const start = initExtension(understandings, deps);

	const knownItems = new Map<string, ArticleItem>();

	function trackItems(items: ArticleItem[]): void {
		for (const item of items) {
			knownItems.set(item.id, item);
		}
	}

	function arrayBufferToBase64(buffer: ArrayBuffer): string {
		const view = new Uint8Array(buffer);
		let binaryString = "";
		for (let i = 0; i < view.length; i += 1) {
			const byte = view[i];
			assert(byte !== undefined, "loop index within Uint8Array bounds");
			binaryString += String.fromCharCode(byte);
		}
		return btoa(binaryString);
	}

	const saveUrl: SaveUrl = async ({ url, title, rawHtml, pdfBytes }) => {
		const collection = await start();
		trackItems(collection.items);
		const saveContentAction = collection.actions["save-content"];
		if (saveContentAction) {
			if (pdfBytes) {
				const result = await saveContentAction({
					url,
					mediaType: "application/pdf",
					contentBase64: arrayBufferToBase64(pdfBytes),
				});
				const item = result.items[0];
				trackItems(result.items);
				return { ok: true, item };
			}
			if (rawHtml) {
				const result = await saveContentAction({
					url,
					mediaType: "text/html",
					rawHtml,
					title,
				});
				const item = result.items[0];
				trackItems(result.items);
				return { ok: true, item };
			}
		}
		const savePdfAction = collection.actions["save-pdf"];
		if (pdfBytes && savePdfAction) {
			const result = await savePdfAction({ url, pdfBytes: arrayBufferToBase64(pdfBytes) });
			const item = result.items[0];
			trackItems(result.items);
			return { ok: true, item };
		}
		const saveHtmlAction = collection.actions["save-html"];
		if (rawHtml && saveHtmlAction) {
			const result = await saveHtmlAction({ url, rawHtml, title });
			const item = result.items[0];
			trackItems(result.items);
			return { ok: true, item };
		}
		const saveAction = collection.actions["save-article"];
		assert(
			saveAction,
			'Expected Siren action "save-article" not found in response',
		);
		try {
			const result = await saveAction({ url });
			const item = result.items[0];
			trackItems(result.items);
			return { ok: true, item };
		} catch (err) {
			if (err instanceof NotSaveableError) {
				const failure: { ok: false; reason: "not-saveable"; items: ReadingListItem[]; warning?: SaveWarning } = {
					ok: false,
					reason: "not-saveable",
					items: err.items,
				};
				if (err.warning) failure.warning = err.warning;
				return failure;
			}
			throw err;
		}
	};

	const removeUrl: RemoveUrl = async (id) => {
		let item = knownItems.get(id);
		if (!item) {
			const collection = await start();
			trackItems(collection.items);
			item = knownItems.get(id);
		}
		assert(item?.actions.delete, `No delete action found for item ${id}`);
		try {
			const result = await item.actions.delete();
			knownItems.clear();
			trackItems(result.items);
			return { ok: true, items: result.items };
		} catch (err) {
			if (err instanceof Error && err.message === "Delete failed: 404") {
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

	const getAllItems: GetAllItems = async () => {
		const collection = await start();
		trackItems(collection.items);
		return collection.items;
	};

	return { saveUrl, removeUrl, findByUrl, getAllItems };
}
