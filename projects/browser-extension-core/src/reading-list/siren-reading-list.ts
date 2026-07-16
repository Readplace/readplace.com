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
import type {
	BulkSavePage,
	BulkSaveResult,
	FindByUrl,
	GetAllItems,
	InvokeAction,
	Message,
	SaveUrl,
	SavePages,
	SaveWarning,
} from "./reading-list.types";
import { pdfContentBody, htmlContentBody, base64ToBytes, type ContentBodyBuilder } from "./content-body-parsers";

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
		public readonly items: ReadingListItem[],
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
	type: z.enum(["warning", "error"]),
	content: z.object({ type: z.string(), body: z.string() }),
});

/** A refusal the server expresses as messages for the client to render verbatim
 * — no feature-specific code, no action. Distinct from SirenErrorSchema (a
 * code + message): the client keys off the presence of `properties.messages`. */
const SirenMessagesErrorSchema = z.object({
	properties: z.object({ messages: z.array(SirenMessageSchema).min(1) }),
});

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
 * BEFORE the save-html/save-content fallback logic so a message-only refusal is
 * never mistaken for a fallback action. */
function throwIfBlocked(body: unknown): void {
	const parsed = SirenMessagesErrorSchema.safeParse(body);
	if (parsed.success) throw new SaveBlockedError(parsed.data.properties.messages);
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
	}),
});

const SirenCollectionResponseSchema = z.object({
	class: z.array(z.string()).optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	entities: z.array(SirenSubEntitySchema).default([]),
	links: lenientArray(SirenLinkSchema),
	actions: lenientArray(SirenActionSchema),
});

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

function createAuthorizedFetch(deps: {
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: () => Promise<void>;
}): DoFetch {
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
	/** Set only by the save-articles understanding; carries the bulk-save
	 * summary so `savePages` can surface it. Other actions leave it undefined. */
	bulk?: BulkSaveResult;
};

function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function advertisedLimit(
	descriptor: SirenAction | undefined,
	fieldName: string,
	limit: "maxBytes" | "maxItems",
): number | undefined {
	return descriptor?.fields?.find((field) => field.name === fieldName)?.[limit];
}

/** Bulk limits enforced by servers that predate limit advertisement: a 20-page
 * manifest cap and a 20 MiB per-page budget. Assumed whenever save-articles
 * advertises no maxItems/maxBytes, so a request never exceeds what an old
 * server accepts (an unsplit window would be refused wholesale). */
const LEGACY_SERVER_BULK_LIMITS = { maxItems: 20, maxBytes: 20 * 1024 * 1024 };

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
					const parsed = await context.parseCollection(collection.data);
					throw new NotSaveableError(
						parsed.items,
						extractCollectionWarning(collection.data),
					);
				}
				throw new Error(`Save failed: ${response.status}`);
			}
			const body = SirenSubEntitySchema.parse(await readSirenBody(response));
			const item = context.resolveItem(body);
			return { items: [item], actions: {}, descriptors: {} };
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
			return { items: [], actions: {}, descriptors: {}, bulk: body.properties };
		};
	});
	return handlers;
}

export function initSaveHtmlUnderstanding(deps: {
	logger: HutchLogger;
}): Map<string, ActionHandler> {
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
			const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
			assert(actionUrl, "save-html action href is not actionable");
			const response = await context.doFetch(
				actionUrl,
				{
					method: sirenAction.method,
					headers: {
						"Content-Type": sirenAction.type ?? "application/json",
					},
					body: JSON.stringify(body),
				},
			);
			if (!response.ok) {
				const fallbackFields: Record<string, string> = { url: fields.url };
				if (fields.title) fallbackFields.title = fields.title;
				return followSaveFallback({
					response,
					context,
					logger: deps.logger,
					fallbackFields,
				});
			}
			const responseBody = SirenSubEntitySchema.parse(await readSirenBody(response));
			const item = context.resolveItem(responseBody);
			return { items: [item], actions: {}, descriptors: {} };
		};
	});
	return handlers;
}

/** The shared fallback the server advertises inside a Siren error body when a
 * rich save (save-html / save-content) can't be honoured: follow whatever action
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
	return { items: [fallbackItem], actions: {}, descriptors: {} };
}

export function initSaveContentUnderstanding(deps: {
	parsers: Record<string, ContentBodyBuilder>;
	logger: HutchLogger;
}): Map<string, ActionHandler> {
	const handlers = new Map<string, ActionHandler>();
	handlers.set("save-content", (sirenAction, context) => {
		return async (input) => {
			assert(input?.url, "save-content requires a url field");
			assert(input?.mediaType, "save-content requires a mediaType field");
			const parser = deps.parsers[input.mediaType];
			assert(parser, `No content parser registered for media type: ${input.mediaType}`);
			const { blob, filename } = parser(input);
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
			return { items: [item], actions: {}, descriptors: {} };
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
			const items = await collectPages({
				firstUrl: filterUrl.toString(),
				method: sirenAction.method,
				context,
			});
			return { items, actions: {}, descriptors: {} };
		};
	});
	return handlers;
}

/** The next page URL the server advertised, resolved through the one href helper,
 * or undefined when there is no further page. The client never builds a `?page=`
 * param — it follows the opaque `next` href the server returns. */
function nextPageUrl(deps: {
	body: SirenCollectionResponse;
	base: string;
}): string | undefined {
	const nextHref = deps.body.links.find((link) => link.rel.includes("next"))?.href;
	return nextHref ? resolveHref({ base: deps.base, href: nextHref }) : undefined;
}

/** The one pagination walk both navigation and search share: gather the items of
 * the first page, then follow the server's `next` links until there is none, so
 * no saved item is unreachable past page 1. A `visited` set stops a repeating or
 * self-referential `next` href from looping forever — an ETag 304 re-yields the
 * same `next`, so without the guard a server that points `next` back at a page
 * already seen never terminates. The first page is either supplied pre-fetched
 * (navigation already read it to resolve the `self` link) or fetched from
 * `firstUrl` (search); both then loop through the identical follow-next path. */
async function collectPages(args: {
	context: ActionContext;
	method: string;
	firstUrl: string;
	firstBody?: SirenCollectionResponse;
}): Promise<ArticleItem[]> {
	const { context, method, firstUrl, firstBody } = args;
	const items: ArticleItem[] = [];
	const visited = new Set<string>();

	let nextUrl: string | undefined = firstUrl;
	if (firstBody) {
		for (const entity of firstBody.entities) items.push(context.resolveItem(entity));
		visited.add(firstUrl);
		nextUrl = nextPageUrl({ body: firstBody, base: context.serverUrl });
	}

	while (nextUrl && !visited.has(nextUrl)) {
		visited.add(nextUrl);
		const response = await context.doFetch(nextUrl, { method });
		if (!response.ok) return items;
		const body = SirenCollectionResponseSchema.parse(await readSirenBody(response));
		for (const entity of body.entities) items.push(context.resolveItem(entity));
		nextUrl = nextPageUrl({ body, base: context.serverUrl });
	}
	return items;
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
		/** The self link is resolved before any parse, so the first page's URL is
		 * known and can seed the visited set against a self-referential `next`. */
		assert(resolvedUrl, "Collection self link must be resolved before parsing");
		const items = await collectPages({
			context,
			method: "GET",
			firstUrl: resolvedUrl,
			firstBody: body,
		});
		const { actions, descriptors } = bindCollectionActions(body.actions, doFetch);
		return { items, actions, descriptors };
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

export interface SirenReadingListDeps {
	serverUrl: string;
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: () => Promise<void>;
	logger: HutchLogger;
}

export function initSirenReadingList(deps: SirenReadingListDeps): {
	saveUrl: SaveUrl;
	invokeAction: InvokeAction;
	findByUrl: FindByUrl;
	getAllItems: GetAllItems;
	savePages: SavePages;
} {
	const understandings = groupOf(
		initSaveArticleUnderstanding(),
		initSaveArticlesUnderstanding(),
		initSaveHtmlUnderstanding({ logger: deps.logger }),
		initSaveContentUnderstanding({
			parsers: {
				"application/pdf": pdfContentBody,
				"text/html": htmlContentBody,
			},
			logger: deps.logger,
		}),
		/** search carries its own `httpCacheable` ETag layer so the understanding is
		 * cacheable on its own terms, not by silently relying on the walker's
		 * navigation cache also seeing the GET. Both layers share one If-None-Match
		 * path, so a search GET passing through both stays correct. */
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

	async function saveViaUploadSlot(params: {
		descriptor: SirenAction;
		url: string;
		title?: string;
		content: { bytes: ArrayBuffer; mediaType: string };
	}): Promise<ReadingListItem> {
		const authFetch = createAuthorizedFetch(deps);

		const slotHref = resolveHref({ base: deps.serverUrl, href: params.descriptor.href });
		assert(slotHref, "save-content action href is not actionable");
		const slotForm = new FormData();
		slotForm.append("url", params.url);
		slotForm.append("mediaType", params.content.mediaType);
		slotForm.append("size", String(params.content.bytes.byteLength));
		if (params.title) slotForm.append("title", params.title);
		const slotResponse = await authFetch(slotHref, { method: params.descriptor.method, body: slotForm });
		assert(slotResponse.ok, `upload-slot request failed: ${slotResponse.status}`);
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
		assert(
			putResponse.ok,
			`content upload failed: ${putResponse.status} ${await putResponse.text().catch(() => "")}`,
		);

		const completeHref = resolveHref({ base: deps.serverUrl, href: completeAction.href });
		assert(completeHref, "save-uploaded-content action href is not actionable");
		assert(completeAction.fields, "completion action must declare fields");
		const completeForm = new FormData();
		for (const field of completeAction.fields) {
			if (field.value !== undefined) completeForm.append(field.name, String(field.value));
		}
		const completeResponse = await authFetch(completeHref, { method: completeAction.method, body: completeForm });
		assert(completeResponse.ok, `save-uploaded-content failed: ${completeResponse.status}`);
		return toReadingListItem(SirenSubEntitySchema.parse(await readSirenBody(completeResponse)), deps.serverUrl);
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
						return { ok: true, item };
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
				return { ok: true, item: result.items[0] };
			}
			const saveHtmlAction = collection.actions["save-html"];
			if (content?.mediaType === "text/html" && saveHtmlAction) {
				const rawHtml = new TextDecoder().decode(content.bytes);
				const result = await saveHtmlAction({ url, rawHtml, title });
				trackItems(result.items);
				return { ok: true, item: result.items[0] };
			}
			const saveAction = collection.actions["save-article"];
			assert(
				saveAction,
				'Expected Siren action "save-article" not found in response',
			);
			const result = await saveAction({ url });
			trackItems(result.items);
			return { ok: true, item: result.items[0] };
		} catch (err) {
			/** A save the server refused with messages (e.g. a locked account):
			 * surface them so the popup renders the warning and drops the user
			 * back into the list, rather than throwing a generic failure. */
			if (err instanceof SaveBlockedError) {
				return { ok: false, messages: err.messages };
			}
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
		try {
			const result = await boundAction();
			knownItems.clear();
			trackItems(result.items);
			return { ok: true, items: result.items };
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

	const getAllItems: GetAllItems = async () => {
		const collection = await start();
		trackItems(collection.items);
		return collection.items;
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

	function packRequests(
		pages: BulkSavePage[],
		limits: { maxItems: number; maxBytes: number },
	): BulkSavePage[][] {
		const requests: BulkSavePage[][] = [];
		let current: BulkSavePage[] = [];
		let currentBytes = 0;
		for (const page of pages) {
			/** A page's request cost is its captured bytes plus its manifest entry —
			 * a long URL or tab title spends the same budget as content, so a packed
			 * request never outgrows the server's parser cap by manifest weight. */
			const bytes =
				(page.content?.bytes.byteLength ?? 0) +
				new TextEncoder().encode(JSON.stringify(manifestEntryFor(page))).length;
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
		const summary: BulkSaveResult = { saved: 0, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] };
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

		const sendable = pages.map((page) => {
			const bytes = page.content?.bytes.byteLength ?? 0;
			if (bytes > maxBytes) {
				deps.logger.warn(
					`Captured page of ${bytes} bytes exceeds the ${maxBytes}-byte bulk upload limit — saving URL-only`,
				);
				summary.tooBig.push({ url: page.url, mb: bytesToMb(bytes) });
				const { content: _content, ...urlOnly } = page;
				return urlOnly;
			}
			return page;
		});

		for (const request of packRequests(sendable, { maxItems, maxBytes })) {
			try {
				const result = await action(requestFor(request));
				assert(result.bulk, "save-articles response missing bulk summary");
				summary.saved += result.bulk.saved;
				summary.skipped += result.bulk.skipped;
				summary.failed += result.bulk.failed;
				summary.tooBig.push(...result.bulk.tooBig);
				summary.skippedUrls.push(...result.bulk.skippedUrls);
			} catch (err) {
				if (err instanceof UnauthorizedError) throw err;
				summary.failed += request.length;
			}
		}
		return summary;
	};

	return { saveUrl, invokeAction, findByUrl, getAllItems, savePages };
}
