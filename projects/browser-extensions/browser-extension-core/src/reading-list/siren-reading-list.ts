import "../zod-config";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ActionDescriptor,
	LinkDescriptor,
	ReadingListItem,
} from "../domain/reading-list-item.types";
import { ReadingListItemIdSchema } from "../domain/reading-list-item-id";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type { RefreshTokens } from "../auth/auth.types";
import type {
	BulkSavePage,
	BulkSaveResult,
	CollectionPage,
	FindByUrl,
	GetItems,
	InvokeAction,
	LoadPage,
	LoadPageResult,
	Message,
	PageDescriptor,
	SaveUrl,
	SavePages,
	SaveWarning,
	TabContent,
	UploadContent,
	UploadContentResult,
} from "./reading-list.types";
import { capturedContentBody, base64ToBytes } from "./content-body-parsers";

const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

// Cannot use node:assert in browser bundles — this minimal assert
// narrows the asserts-value for runtime invariants.
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Thrown when a response carries a media type the client can't parse as Siren.
 * A browser negotiating with Accept would render an "I don't understand this
 * type" page rather than blind-decoding a proxy's HTML or a future media type. */
class UnsupportedMediaTypeError extends Error {
	constructor(public readonly contentType: string | null) {
		super(`Unsupported media type: ${contentType ?? "(none)"}`);
	}
}

class ItemGoneError extends Error {
	constructor(actionName: string) {
		super(`${actionName} target not found`);
	}
}

/** Asserts a mutation response is ok, distinguishing a 404 (the item/action is
 * gone — a typed ItemGoneError the adapter maps to not-found) from any other
 * failure (a generic Error the adapter propagates). */
function assertMutationOk(deps: { response: Response; actionName: string }): void {
	if (deps.response.status === 404) throw new ItemGoneError(deps.actionName);
	assert(deps.response.ok, `${deps.actionName} failed: ${deps.response.status}`);
}

/** The one href resolver every call site shares. An `http(s)://` href is used
 * verbatim (so a server that re-points a link to an absolute URL keeps working);
 * a scheme-less href is resolved against the base; any other scheme is no href
 * (unactionable), so a `mailto:`/`javascript:` href never becomes a fetch target.
 * `base + href` concatenation at each call site corrupts an absolute href and
 * mis-resolves other schemes — the contract promises changing an href is
 * non-breaking, which only holds if resolution is uniform. */
function resolveHref(deps: { base: string; href: string }): string | undefined {
	if (/^https?:\/\//i.test(deps.href)) return deps.href;
	if (/^[a-z][a-z0-9+.-]*:/i.test(deps.href)) return undefined;
	return new URL(deps.href, deps.base).toString();
}

/** Reads a Siren body, refusing any response whose Content-Type is not the
 * negotiated Siren media type. A 304-from-cache synthesises the Siren type, so a
 * cache hit still passes. */
async function readSirenBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type");
	if (!contentType?.includes(SIREN_MEDIA_TYPE)) {
		throw new UnsupportedMediaTypeError(contentType);
	}
	return response.json();
}

/** Thrown when the server rejects a save by returning the current collection
 * (e.g. for non-saveable URL schemes). Carries the items so the caller can
 * drop the user back into the list view without a re-fetch. The optional
 * `warning` carries the server-authored human-readable reason so the popup
 * can surface it next to the list. */
class NotSaveableError extends Error {
	constructor(
		public readonly collection: NavigationResult,
		public readonly warning?: SaveWarning,
	) {
		super("URL not saveable");
	}
}

/** Only the identity field (`id`) is required: an evolving or stub entity that
 * omits `title`/`url`/`savedAt` must degrade to a renderable row, not blank the
 * whole collection. The render layer fills sensible blanks for the absent ones. */
const SirenPropertiesSchema = z.object({
	id: ReadingListItemIdSchema,
	url: z.string().default(""),
	title: z.string().default(""),
	savedAt: z.string().optional(),
	needsBrowserCapture: z.boolean().default(false),
});

const SirenLinkSchema = z.object({
	rel: z.array(z.string()),
	href: z.string(),
	/** The human label the server authored for this link. When a semantic link is
	 * rendered as a control, the client uses it as the label; absent, the client
	 * humanizes the rel. */
	title: z.string().optional(),
});

const SirenActionSchema = z.object({
	name: z.string(),
	/** The human label the server authored for this affordance. A client uses it
	 * as the control's text and its aria-label/tooltip; absent, the client
	 * humanizes `name`. Presentation (style/icon) is never derived from it. */
	title: z.string().optional(),
	href: z.string(),
	method: z.string(),
	type: z.string().optional(),
	fields: z
		.array(
			z.object({
				name: z.string(),
				type: z.string(),
				/** The server-suggested target value for this field. A generic client
				 * invoked by (id, name) supplies no field knowledge, so the body is
				 * built from each declared field's own `value` — this is what makes a
				 * bare invocation carry the right inputs (e.g. update-status's
				 * status=read) without the caller knowing the field. Accepts a number
				 * so a numeric server value coerces to a string at body-build time
				 * rather than failing the whole-affordance parse and dropping the
				 * control. */
				value: z.union([z.string(), z.number()]).optional(),
				maxBytes: z.number().optional(),
				maxItems: z.number().optional(),
				maxRequestBytes: z.number().optional(),
			}),
		)
		.optional(),
});

/** Parses an array leniently: a single malformed element (e.g. a hrefless
 * control, which Siren forbids) is dropped to unactionable rather than failing
 * the whole array — the same tolerance entity `properties` already get. */
function lenientArray<T>(element: z.ZodType<T>): z.ZodType<T[]> {
	return z
		.array(z.unknown())
		.optional()
		.transform((items) =>
			(items ?? []).flatMap((item) => {
				const parsed = element.safeParse(item);
				return parsed.success ? [parsed.data] : [];
			}),
		);
}

const SirenSubEntitySchema = z.object({
	properties: z.record(z.string(), z.unknown()).optional(),
	links: lenientArray(SirenLinkSchema),
	actions: lenientArray(SirenActionSchema),
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
/** The post-parse shape: `links`/`actions` are always arrays (the lenient
 * transform supplies `[]`). `resolveItem` re-parses whatever it is handed
 * (a raw or already-parsed entity), so its input is `unknown`. */
type SirenSubEntity = z.infer<typeof SirenSubEntitySchema>;

/** `content.type` is `z.string()`, not `z.literal("text/html")`: the client
 * accepts the message envelope whatever the media type, then ignores the ones it
 * can't render (see `buildMessageView`). Rejecting an unknown media type here
 * would discard a whole refusal — including any sibling `text/html` message — and
 * fall through to a generic failure, which is the opposite of "ignore it". */
const SirenMessageSchema = z.object({
	type: z.enum(["success", "warning", "error"]),
	content: z.object({ type: z.string(), body: z.string() }),
});

/** The server's generic message channel wherever it rides an entity: absent
 * when the server sent none, so a caller renders whatever it was given. */
const SirenMessagesSchema = z.object({
	properties: z.object({ messages: z.array(SirenMessageSchema).min(1) }),
});

function readMessages(body: unknown): Message[] {
	const parsed = SirenMessagesSchema.safeParse(body);
	return parsed.success ? parsed.data.properties.messages : [];
}

/** Thrown when a save is refused with server-authored messages (e.g. a locked
 * account). Carries the messages so the popup renders them generically and
 * drops the user back into the list — there is nothing for the client to "do",
 * only something for the user to read, so the refusal models no action. */
class SaveBlockedError extends Error {
	constructor(public readonly messages: Message[]) {
		super("Save blocked");
	}
}

/** Surfaces a message-only refusal as a SaveBlockedError. A no-op when the body
 * isn't one, so the caller falls through to its normal error handling. Called
 * BEFORE the save-content fallback logic so a message-only refusal is
 * never mistaken for a fallback action. */
function throwIfBlocked(body: unknown): void {
	const messages = readMessages(body);
	if (messages.length > 0) throw new SaveBlockedError(messages);
}

const SirenWarningSchema = z.object({
	code: z.string(),
	message: z.string(),
});

/** The `save-articles-result` Siren entity the bulk-save route returns. Only
 * `properties` is read; the surrounding `class`/`links` are ignored. The shape
 * matches `BulkSaveResult`, which the popup renders as "Saved N · Skipped M". */
const SaveArticlesResultSchema = z.object({
	properties: z.object({
		saved: z.number(),
		skipped: z.number(),
		failed: z.number(),
		tooBig: z.array(z.object({ url: z.string(), mb: z.number() })),
		skippedUrls: z.array(z.object({ url: z.string(), code: z.string() })),
		results: z
			.array(
				z.object({
					url: z.string(),
					outcome: z.enum(["created", "merged", "skipped", "failed"]),
					code: z.string().optional(),
				}),
			)
			.optional(),
	}),
});

const SirenCollectionResponseSchema = z.object({
	class: z.array(z.string()).optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	entities: z.array(SirenSubEntitySchema).default([]),
	links: lenientArray(SirenLinkSchema),
	actions: lenientArray(SirenActionSchema),
});

const SirenPageSchema = z.object({
	label: z.string(),
	rel: z.enum(["prev", "current", "next"]),
	href: z.string(),
});

type PageEntry = PageDescriptor & { readonly href: string };

function readPageList(deps: {
	body: SirenCollectionResponse;
	base: string;
}): PageEntry[] {
	const parsed = z.array(z.unknown()).safeParse(deps.body.properties?.pages);
	if (!parsed.success) return [];
	return parsed.data.flatMap((entry) => {
		const page = SirenPageSchema.safeParse(entry);
		if (!page.success) return [];
		const href = resolveHref({ base: deps.base, href: page.data.href });
		return href === undefined ? [] : [{ ...page.data, href }];
	});
}

const UploadSlotResponseSchema = z.object({
	actions: lenientArray(SirenActionSchema),
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

/** The only place a 401 may be answered, because it is the only one still
 * holding the request to replay — a caller that refreshes has already lost it,
 * and a rotating refresh token spent twice invalidates the session it was
 * meant to save. `onUnauthorized` ends the session, so it runs only once a
 * replay behind a fresh token is refused too. */
function createAuthorizedFetch(deps: {
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: () => Promise<void>;
	refreshTokens: RefreshTokens;
}): DoFetch {
	async function attempt(url: string, init?: DoFetchInit): Promise<Response> {
		const token = await deps.getAccessToken();
		assert(token, "No access token available");
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			Accept: SIREN_MEDIA_TYPE,
			...init?.headers,
		};
		return deps.fetchFn(url, { ...init, headers });
	}
	return async (url, init) => {
		const response = await attempt(url, init);
		if (response.status !== 401) return response;
		const refreshed = await deps.refreshTokens();
		if (refreshed.ok) {
			const retried = await attempt(url, init);
			if (retried.status !== 401) return retried;
		}
		await deps.onUnauthorized();
		throw new UnauthorizedError();
	};
}

type ActionContext = {
	serverUrl: string;
	doFetch: DoFetch;
	resolveItem: (entity: unknown) => ArticleItem;
	parseCollection: (body: SirenCollectionResponse) => Promise<NavigationResult>;
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
	descriptors: Record<string, SirenAction>;
	pages: PageEntry[];
	followPage: (href: string) => Promise<NavigationResult>;
	/** Set only by the save-articles understanding; carries the bulk-save
	 * summary so `savePages` can surface it. Other actions leave it undefined. */
	bulk?: z.infer<typeof SaveArticlesResultSchema>["properties"];
	/** What the server asked the client to tell the reader about this response;
	 * empty when it asked for nothing. */
	messages: Message[];
};

function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function advertisedLimit(
	descriptor: SirenAction | undefined,
	fieldName: string,
	limit: "maxBytes" | "maxItems" | "maxRequestBytes",
): number | undefined {
	return descriptor?.fields?.find((field) => field.name === fieldName)?.[limit];
}

/** Bulk limits enforced by servers that predate limit advertisement: a 20-page
 * manifest cap and a 20 MiB per-page budget. Assumed whenever save-articles
 * advertises no maxItems/maxBytes, so a request never exceeds what an old
 * server accepts (an unsplit window would be refused wholesale). */
const LEGACY_SERVER_BULK_LIMITS = { maxItems: 20, maxBytes: 20 * 1024 * 1024, maxRequestBytes: 4_718_592 };

const REQUEST_ENVELOPE_RESERVE_BYTES = 16 * 1024;

/** The walker's in-memory item. It keeps the cross-boundary `ReadingListItem`
 * intact — including its serializable `actions` descriptors, which DO survive
 * the popup sendMessage boundary — and adds `boundActions`: the bound callables
 * the walker invokes, keyed by action name. The callables can't be cloned across
 * the boundary, so they live only here; the popup re-invokes by (id, name) and
 * the walker resolves the name back to its `boundActions` entry. */
export type ArticleItem = ReadingListItem & {
	boundActions: Record<string, BoundAction>;
};

/** Rels the client follows for its OWN navigation (pagination/identity), never
 * rendered as user controls. Everything else is a semantic link the client may
 * render through the generic link loop. */
const STRUCTURAL_LINK_RELS = new Set(["self", "root", "prev", "next", "item"]);

function toReadingListItem(
	entity: SirenSubEntity,
	serverUrl: string,
): ReadingListItem {
	assert(entity.properties, "Server response entity missing properties");
	const props = SirenPropertiesSchema.parse(entity.properties);
	/** Semantic (non-structural) links serialized symmetrically with actions: one
	 * descriptor per link whose href resolves, carrying the resolved target so the
	 * popup renders each through the same generic loop. A structural rel is the
	 * client's own navigation and is excluded. */
	const links: LinkDescriptor[] = [];
	for (const link of entity.links) {
		if (link.rel.some((rel) => STRUCTURAL_LINK_RELS.has(rel))) continue;
		const href = resolveHref({ base: serverUrl, href: link.href });
		if (href === undefined) continue;
		for (const rel of link.rel) {
			const descriptor: LinkDescriptor = { rel, href };
			if (link.title !== undefined) descriptor.title = link.title;
			links.push(descriptor);
		}
	}
	const actions: ActionDescriptor[] = entity.actions.map((action) => {
		const descriptor: ActionDescriptor = { name: action.name };
		if (action.title !== undefined) descriptor.title = action.title;
		return descriptor;
	});
	return {
		id: props.id,
		url: props.url,
		title: props.title,
		savedAt: props.savedAt ? new Date(props.savedAt) : new Date(0),
		actions,
		links,
		needsBrowserCapture: props.needsBrowserCapture,
	};
}

export function initSaveArticleUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-article", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.url, "save-article requires a url field");
			const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
			assert(actionUrl, "save-article action href is not actionable");
			const response = await context.doFetch(
				actionUrl,
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
				/** A refusal the server expressed as messages (e.g. a locked
				 * account) surfaces as a SaveBlockedError, not a generic failure. */
				throwIfBlocked(body);
				const collection = SirenCollectionResponseSchema.safeParse(body);
				if (collection.success && collection.data.class?.includes("collection")) {
					throw new NotSaveableError(
						await context.parseCollection(collection.data),
						extractCollectionWarning(collection.data),
					);
				}
				throw new Error(`Save failed: ${response.status}`);
			}
			const body = await readSirenBody(response);
			const item = context.resolveItem(SirenSubEntitySchema.parse(body));
			return { items: [item], actions: {}, descriptors: {}, pages: [], followPage: followPageWith(context), messages: readMessages(body) };
		};
	});
	return handlers;
}

const SaveArticlesManifestSchema = z.array(
	z.object({
		url: z.string(),
		title: z.string().optional(),
		mediaType: z.string().optional(),
	}),
);

export function initSaveArticlesUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-articles", (sirenAction, context) => {
		return async (fields) => {
			assert(fields?.manifest, "save-articles requires a manifest field");
			/** Siren fields are strings, so the caller JSON-encodes the per-page
			 * manifest and base64-encodes each captured page's bytes under a
			 * `contentBase64-<index>` field. Rebuild the multipart body the server
			 * expects: the manifest as a text part, each captured page as a binary
			 * `content-<index>` file part. */
			const manifest = SaveArticlesManifestSchema.parse(JSON.parse(fields.manifest));
			const formData = new FormData();
			formData.append("manifest", fields.manifest);
			manifest.forEach((entry, index) => {
				if (!entry.mediaType) return;
				const base64 = fields[`contentBase64-${index}`];
				assert(
					base64 !== undefined,
					`save-articles manifest entry ${index} declares a mediaType but carries no content`,
				);
				const bytes = base64ToBytes(base64);
				formData.append(`content-${index}`, new Blob([bytes], { type: entry.mediaType }), `content-${index}`);
			});
			const response = await context.doFetch(
				`${context.serverUrl}${sirenAction.href}`,
				{
					method: sirenAction.method,
					body: formData,
				},
			);
			assert(response.ok, `Bulk save failed: ${response.status}`);
			const body = SaveArticlesResultSchema.parse(await response.json());
			return { items: [], actions: {}, descriptors: {}, pages: [], followPage: followPageWith(context), messages: [], bulk: body.properties };
		};
	});
	return handlers;
}

/** The shared fallback the server advertises inside a Siren error body when a
 * rich save (save-content) can't be honoured: follow whatever action
 * it carries to degrade onto a URL-only save. The client owns no policy about
 * when a fallback applies (no size caps, no thresholds) — it attempts the rich
 * save and follows the refusal the server returns. */
async function followSaveFallback(args: {
	response: Response;
	context: ActionContext;
	logger: HutchLogger;
	fallbackFields: Record<string, string>;
}): Promise<NavigationResult> {
	const { response, context, logger, fallbackFields } = args;
	const errorJson = await response.json().catch(() => null);
	throwIfBlocked(errorJson);
	const errorParsed = SirenErrorSchema.safeParse(errorJson);
	assert(errorParsed.success, `Save failed: ${response.status}`);
	const errorActions = errorParsed.data.actions ?? [];
	assert(errorActions.length > 0, `Save failed: ${response.status}`);
	const fallbackAction = errorActions[0];
	logger.warn(errorParsed.data.properties.message);
	const fallbackUrl = resolveHref({ base: context.serverUrl, href: fallbackAction.href });
	assert(fallbackUrl, "Save fallback action href is not actionable");
	const fallbackContentType = fallbackAction.type ?? "application/json";
	const fallbackResponse = await context.doFetch(fallbackUrl, {
		method: fallbackAction.method,
		headers: { "Content-Type": fallbackContentType },
		body: JSON.stringify(fallbackFields),
	});
	assert(fallbackResponse.ok, `Save failed: ${fallbackResponse.status}`);
	const fallbackResponseBody = SirenSubEntitySchema.parse(
		await readSirenBody(fallbackResponse),
	);
	const fallbackItem = context.resolveItem(fallbackResponseBody);
	return { items: [fallbackItem], actions: {}, descriptors: {}, pages: [], followPage: followPageWith(context), messages: [] };
}

export function initSaveContentUnderstanding(deps: {
	logger: HutchLogger;
}): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-content", (sirenAction, context) => {
		return async (input) => {
			assert(input?.url, "save-content requires a url field");
			assert(input?.mediaType, "save-content requires a mediaType field");
			const { blob, filename } = capturedContentBody(input);
			const formData = new FormData();
			formData.append("url", input.url);
			formData.append("mediaType", input.mediaType);
			if (input.title) formData.append("title", input.title);
			formData.append("content", blob, filename);
			const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
			assert(actionUrl, "save-content action href is not actionable");
			const response = await context.doFetch(
				actionUrl,
				{
					method: sirenAction.method,
					body: formData,
				},
			);
			if (!response.ok) {
				const fallbackFields: Record<string, string> = { url: input.url };
				if (input.title) fallbackFields.title = input.title;
				return followSaveFallback({
					response,
					context,
					logger: deps.logger,
					fallbackFields,
				});
			}
			const responseBody = SirenSubEntitySchema.parse(await readSirenBody(response));
			const item = context.resolveItem(responseBody);
			return { items: [item], actions: {}, descriptors: {}, pages: [], followPage: followPageWith(context), messages: readMessages(responseBody) };
		};
	});
	return handlers;
}

/** The fallback understanding for any simple entity action the client has no
 * bespoke handler for: invoke the action by ITS OWN declared href/method/fields
 * and follow the collection the server returns. One generic path means a
 * newly-advertised entity action (e.g. `mark-read`, `archive`) is invokable with
 * no new client code — the contract's "bind a response's actions through one
 * generic path" rule. Only the fields the server declared for the action are
 * sent (never a client-invented name); a fieldless action posts an empty body.
 * A bespoke handler still takes precedence for any action that registers one;
 * this generic path is the default for every entity action, none of which
 * currently needs a bespoke handler.
 *
 * The body comes from each DECLARED field's own server-supplied `value`, not
 * from caller-supplied fields: the (id, name) popup path re-invokes by name with
 * no field knowledge, so the server is the one place the target value can come
 * from (e.g. update-status declares `status` with `value: "read"`). The body is
 * encoded per the action's declared `type`: `x-www-form-urlencoded` builds a
 * URLSearchParams (and sets that Content-Type), anything else is JSON. */
export function genericEntityAction(
	sirenAction: SirenAction,
	context: ActionContext,
): BoundAction {
	return async () => {
		const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
		assert(actionUrl, `${sirenAction.name} action href is not actionable`);
		const values: Record<string, string> = {};
		for (const field of sirenAction.fields ?? []) {
			/** A numeric server value coerces to its string form so URLSearchParams /
			 * JSON both carry it; the union above keeps a numeric `value` from failing
			 * the affordance parse. */
			if (field.value !== undefined) values[field.name] = String(field.value);
		}
		const contentType = sirenAction.type ?? "application/json";
		const isForm = contentType.includes("application/x-www-form-urlencoded");
		const body = isForm
			? new URLSearchParams(values).toString()
			: JSON.stringify(values);
		/** Signal that the client will process a representation in the response
		 * (RFC 7240) so the mutation lands back on the collection. */
		const response = await context.doFetch(actionUrl, {
			method: sirenAction.method,
			headers: {
				"Content-Type": contentType,
				Prefer: "return=representation",
			},
			body,
		});
		assertMutationOk({ response, actionName: sirenAction.name });
		const collection = SirenCollectionResponseSchema.parse(await readSirenBody(response));
		return await context.parseCollection(collection);
	};
}

export function initListArticlesUnderstanding(): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("search", (sirenAction, context) => {
		return async (fields) => {
			const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
			assert(actionUrl, "search action href is not actionable");
			const filterUrl = new URL(actionUrl);
			/** Only the fields the server declared for this action are sent — never
			 * a client-invented param name. A renamed field on the server simply
			 * stops matching, instead of the client hardcoding `url`/`status`. */
			for (const field of sirenAction.fields ?? []) {
				const value = fields?.[field.name];
				if (value !== undefined) filterUrl.searchParams.set(field.name, value);
			}
			const response = await context.doFetch(filterUrl.toString(), { method: sirenAction.method });
			if (!response.ok)
				return {
					items: [],
					actions: {},
					descriptors: {},
					pages: [],
					followPage: followPageWith(context),
					messages: [],
				};
			const body = SirenCollectionResponseSchema.parse(await readSirenBody(response));
			const items = body.entities.map((entity) => context.resolveItem(entity));
			return {
				items,
				actions: {},
				descriptors: {},
				/** The pages of the FILTERED collection: following one carries the
				 * filter, because the server built the href. */
				pages: readPageList({ body, base: context.serverUrl }),
				followPage: followPageWith(context),
				messages: [],
			};
		};
	});
	return handlers;
}

function followPageWith(context: ActionContext): (href: string) => Promise<NavigationResult> {
	return async (href) => {
		const response = await context.doFetch(href, { method: "GET" });
		assert(response.ok, `Page load failed: ${response.status}`);
		const body = SirenCollectionResponseSchema.parse(await readSirenBody(response));
		return context.parseCollection(body);
	};
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
	refreshTokens: RefreshTokens;
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
		return createAuthorizedFetch(deps);
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
		entityInput: unknown,
		doFetch: DoFetch,
	): ArticleItem {
		const entity = SirenSubEntitySchema.parse(entityInput);
		const item = toReadingListItem(entity, deps.serverUrl);
		const boundActions: Record<string, BoundAction> = {};
		const context = createActionContext(doFetch);
		/** Every advertised entity action is bound, not just the ones with a
		 * bespoke handler: a registered handler wins where present,
		 * otherwise the generic invoker handles it, so any newly-advertised simple
		 * entity action is invokable with no new client code. */
		for (const sirenAction of entity.actions) {
			const handler = handlers.get(sirenAction.name);
			boundActions[sirenAction.name] = handler
				? handler(sirenAction, context)
				: genericEntityAction(sirenAction, context);
		}
		return { ...item, boundActions };
	}

	function bindCollectionActions(
		sirenActions: SirenAction[],
		doFetch: DoFetch,
	): { actions: Record<string, BoundAction>; descriptors: Record<string, SirenAction> } {
		const actions: Record<string, BoundAction> = {};
		const descriptors: Record<string, SirenAction> = {};
		const context = createActionContext(doFetch);
		for (const sirenAction of sirenActions) {
			descriptors[sirenAction.name] = sirenAction;
			const handler = handlers.get(sirenAction.name);
			if (handler) {
				actions[sirenAction.name] = handler(sirenAction, context);
			}
		}
		return { actions, descriptors };
	}

	async function parseResponse(
		body: SirenCollectionResponse,
		doFetch: DoFetch,
	): Promise<NavigationResult> {
		const context = createActionContext(doFetch);
		assert(resolvedUrl, "Collection self link must be resolved before parsing");
		const items = body.entities.map((entity) => context.resolveItem(entity));
		const { actions, descriptors } = bindCollectionActions(body.actions, doFetch);
		return {
			items,
			actions,
			descriptors,
			pages: readPageList({ body, base: deps.serverUrl }),
			followPage: followPageWith(context),
			messages: readMessages(body),
		};
	}

	return async () => {
		const doFetch = createCachingFetch(navigationCache, createDoFetch());

		const targetUrl = resolvedUrl ?? `${deps.serverUrl}${ENTRY_POINT}`;
		const response = await doFetch(targetUrl, { method: "GET" });
		assert(response.ok, `Navigation failed: ${response.status}`);

		const body = SirenCollectionResponseSchema.parse(await readSirenBody(response));

		if (!resolvedUrl) {
			const selfLink = body.links.find((l) => l.rel.includes("self"));
			assert(selfLink, "Collection response missing self link");
			const selfUrl = resolveHref({ base: deps.serverUrl, href: selfLink.href });
			assert(selfUrl, "Collection self link is not actionable");
			resolvedUrl = selfUrl;

			const cachedEntry = navigationCache.get(targetUrl);
			if (cachedEntry && resolvedUrl !== targetUrl) {
				navigationCache.set(resolvedUrl, cachedEntry);
			}
		}

		return parseResponse(body, doFetch);
	};
}

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
	onUnauthorized: () => Promise<void>;
	refreshTokens: RefreshTokens;
	logger: HutchLogger;
	onAdvertisedActions: (names: string[]) => void;
}

export function initSirenReadingList(deps: SirenReadingListDeps): {
	saveUrl: SaveUrl;
	uploadContent: UploadContent;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getItems: GetItems;
	loadPage: LoadPage;
	savePages: SavePages;
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
		| { index: number; ticket: number; promise: Promise<LoadPageResult> }
		| undefined;

	function toCollectionPage(adopted: AdoptedCollection): CollectionPage {
		/** The popup is handed labels and relations only — the server's opaque page
		 * hrefs stay here, so a page is asked for by position and the popup can
		 * neither build nor replay a URL. */
		return {
			items: adopted.items,
			pages: adopted.pages.map(({ label, rel }) => ({ label, rel })),
		};
	}

	function adoptCollection(result: NavigationResult): CollectionPage {
		requestSeq += 1;
		current = {
			items: result.items,
			pages: result.pages,
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

	const loadPage: LoadPage = async ({ index }) => {
		const adopted = current;
		if (!adopted) return { pageList: "lost" };
		const entry = adopted.pages[index];
		/** The page list moved under the click (or never had this entry): report it
		 * lost so the caller re-reads the list rather than rendering an empty page. */
		if (!entry) return { pageList: "lost" };
		if (inFlight?.index === index) return inFlight.promise;
		requestSeq += 1;
		const ticket = requestSeq;
		const pending = fetchPage({ adopted, href: entry.href, ticket }).finally(() => {
			if (inFlight?.ticket === ticket) inFlight = undefined;
		});
		inFlight = { index, ticket, promise: pending };
		return pending;
	};

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

	/** Runs the three legs of the presigned slot and hands back whichever
	 * response ended the exchange — the first refusal, or the completion — tagged
	 * with the leg that produced it, so each caller applies its own policy to a
	 * failure instead of one shared assert deciding for both. */
	async function uploadThroughSlot(params: {
		descriptor: SirenAction;
		url: string;
		title?: string;
		content: TabContent;
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
		const attempt = await uploadThroughSlot(params);
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
					warning?: SaveWarning;
				} = {
					ok: false,
					reason: "not-saveable",
					items: page.items,
					pages: page.pages,
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
	const uploadContent: UploadContent = async ({ url, title, content }) => {
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
			return classifyUpload(await uploadThroughSlot({ descriptor, url, title, content }));
		}
		const actionUrl = resolveHref({ base: deps.serverUrl, href: descriptor.href });
		assert(actionUrl, "save-content action href is not actionable");
		const form = new FormData();
		form.append("url", url);
		form.append("mediaType", content.mediaType);
		if (title) form.append("title", title);
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
			return { ok: true, items: page.items, pages: page.pages, targetUrl };
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

	function manifestEntryFor(page: BulkSavePage): { url: string; title?: string; mediaType?: string } {
		const entry: { url: string; title?: string; mediaType?: string } = { url: page.url };
		if (page.title !== undefined) entry.title = page.title;
		if (page.content) entry.mediaType = page.content.mediaType;
		return entry;
	}

	function requestFor(pages: BulkSavePage[]): Record<string, string> {
		/** The bound action takes only string fields, so the manifest is JSON and
		 * each captured page's bytes ride along base64-encoded under a
		 * `contentBase64-<index>` field; the understanding rebuilds the multipart
		 * body from them. */
		const fields: Record<string, string> = {
			manifest: JSON.stringify(pages.map(manifestEntryFor)),
		};
		pages.forEach((page, index) => {
			if (page.content) fields[`contentBase64-${index}`] = arrayBufferToBase64(page.content.bytes);
		});
		return fields;
	}

	/** A page's request cost is its captured bytes plus its manifest entry —
	 * a long URL or tab title spends the same budget as content, so a packed
	 * request never outgrows the server's parser cap by manifest weight. */
	function requestCostOf(page: BulkSavePage): number {
		return (
			(page.content?.bytes.byteLength ?? 0) +
			new TextEncoder().encode(JSON.stringify(manifestEntryFor(page))).length
		);
	}

	function packRequests(
		pages: BulkSavePage[],
		limits: { maxItems: number; maxBytes: number },
	): BulkSavePage[][] {
		const requests: BulkSavePage[][] = [];
		let current: BulkSavePage[] = [];
		let currentBytes = 0;
		for (const page of pages) {
			const bytes = requestCostOf(page);
			const overCount = current.length > 0 && current.length >= limits.maxItems;
			const overBytes = current.length > 0 && currentBytes + bytes > limits.maxBytes;
			if (overCount || overBytes) {
				requests.push(current);
				current = [];
				currentBytes = 0;
			}
			current.push(page);
			currentBytes += bytes;
		}
		if (current.length > 0) requests.push(current);
		return requests;
	}

	const savePages: SavePages = async ({ pages }) => {
		const summary: BulkSaveResult = {
			saved: 0,
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
		const requestBudget = maxRequestBytes - REQUEST_ENVELOPE_RESERVE_BYTES;

		const sendable = pages.map((page) => {
			const bytes = page.content?.bytes.byteLength ?? 0;
			let candidate = page;
			if (bytes > maxBytes) {
				deps.logger.warn(
					`Captured page of ${bytes} bytes exceeds the ${maxBytes}-byte bulk upload limit — saving URL-only`,
				);
				summary.tooBig.push({ url: page.url, mb: bytesToMb(bytes) });
				const { content: _content, ...urlOnly } = page;
				candidate = urlOnly;
			} else if (page.content && requestCostOf(page) > requestBudget) {
				deps.logger.warn(
					`Captured page of ${bytes} bytes plus its manifest entry exceeds the ${requestBudget}-byte request budget — saving URL-only`,
				);
				summary.tooBig.push({ url: page.url, mb: bytesToMb(bytes) });
				const { content: _content, ...urlOnly } = page;
				candidate = urlOnly;
			}
			if (requestCostOf(candidate) > requestBudget) {
				deps.logger.warn(
					`Manifest entry for ${candidate.url} exceeds the ${requestBudget}-byte request budget — dropping its title`,
				);
				return { url: candidate.url };
			}
			return candidate;
		});

		const requests = packRequests(sendable, {
			maxItems,
			maxBytes: Math.min(maxBytes, requestBudget),
		});
		for (const [i, request] of requests.entries()) {
			try {
				const result = await action(requestFor(request));
				assert(result.bulk, "save-articles response missing bulk summary");
				const results = result.bulk.results ?? [];
				summary.saved += result.bulk.saved;
				summary.skipped += result.bulk.skipped;
				summary.failed += result.bulk.failed;
				summary.tooBig.push(...result.bulk.tooBig);
				summary.skippedUrls.push(...result.bulk.skippedUrls);
				summary.alreadySaved += results.filter((entry) => entry.outcome === "merged").length;
				summary.failedUrls.push(
					...results.filter((entry) => entry.outcome === "failed").map((entry) => ({ url: entry.url })),
				);
				const accounted = result.bulk.saved + result.bulk.skipped + result.bulk.failed;
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

	return { saveUrl, uploadContent, invokeAction, findByUrl, getItems, loadPage, savePages };
}
