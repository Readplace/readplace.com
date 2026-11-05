import "../zod-config";
import { z } from "zod";
import { ReadingListItemIdSchema } from "../domain/reading-list-item-id";
import { assert } from "../invariant";
import type {
	Message,
	PageDescriptor,
	SortDescriptor,
	CollectionTotal,
	SaveWarning,
} from "./reading-list.types";

export const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

/** Thrown when a response carries a media type the client can't parse as Siren.
 * A browser negotiating with Accept would render an "I don't understand this
 * type" page rather than blind-decoding a proxy's HTML or a future media type. */
class UnsupportedMediaTypeError extends Error {
	constructor(public readonly contentType: string | null) {
		super(`Unsupported media type: ${contentType ?? "(none)"}`);
	}
}

export class ItemGoneError extends Error {
	constructor(actionName: string) {
		super(`${actionName} target not found`);
	}
}

export class RefreshUnavailableError extends Error {
	constructor() {
		super("token refresh unavailable");
	}
}

/** Asserts a mutation response is ok, distinguishing a 404 (the item/action is
 * gone — a typed ItemGoneError the adapter maps to not-found) from any other
 * failure (a generic Error the adapter propagates). */
export function assertMutationOk(deps: { response: Response; actionName: string }): void {
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
export function resolveHref(deps: { base: string; href: string }): string | undefined {
	if (/^https?:\/\//i.test(deps.href)) return deps.href;
	if (/^[a-z][a-z0-9+.-]*:/i.test(deps.href)) return undefined;
	return new URL(deps.href, deps.base).toString();
}

/** Reads a Siren body, refusing any response whose Content-Type is not the
 * negotiated Siren media type. A 304-from-cache synthesises the Siren type, so a
 * cache hit still passes. */
export async function readSirenBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type");
	if (!contentType?.includes(SIREN_MEDIA_TYPE)) {
		throw new UnsupportedMediaTypeError(contentType);
	}
	return response.json();
}

/** Only the identity field (`id`) is required: an evolving or stub entity that
 * omits `title`/`url`/`savedAt` must degrade to a renderable row, not blank the
 * whole collection. The render layer fills sensible blanks for the absent ones. */
export const SirenPropertiesSchema = z.object({
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

export const SirenSubEntitySchema = z.object({
	properties: z.record(z.string(), z.unknown()).optional(),
	links: lenientArray(SirenLinkSchema),
	actions: lenientArray(SirenActionSchema),
});

export const SirenErrorSchema = z.object({
	class: z.array(z.string()).optional(),
	properties: z.object({
		code: z.string(),
		message: z.string(),
	}),
	actions: lenientArray(SirenActionSchema),
});

export type SirenAction = z.infer<typeof SirenActionSchema>;

/** The post-parse shape: `links`/`actions` are always arrays (the lenient
 * transform supplies `[]`). `resolveItem` re-parses whatever it is handed
 * (a raw or already-parsed entity), so its input is `unknown`. */
export type SirenSubEntity = z.infer<typeof SirenSubEntitySchema>;

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

export function readMessages(body: unknown): Message[] {
	const parsed = SirenMessagesSchema.safeParse(body);
	return parsed.success ? parsed.data.properties.messages : [];
}

/** Thrown when a save is refused with server-authored messages (e.g. a locked
 * account). Carries the messages so the popup renders them generically and
 * drops the user back into the list — there is nothing for the client to "do",
 * only something for the user to read, so the refusal models no action. */
export class SaveBlockedError extends Error {
	constructor(public readonly messages: Message[]) {
		super("Save blocked");
	}
}

/** Surfaces a message-only refusal as a SaveBlockedError. A no-op when the body
 * isn't one, so the caller falls through to its normal error handling. Called
 * BEFORE the save-content fallback logic so a message-only refusal is
 * never mistaken for a fallback action. */
export function throwIfBlocked(body: unknown): void {
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
export const SaveArticlesResultSchema = z.object({
	properties: z.object({
		saved: z.number(),
		queued: z.number().default(0),
		skipped: z.number(),
		failed: z.number(),
		tooBig: z.array(z.object({ url: z.string(), mb: z.number() })),
		skippedUrls: z.array(z.object({ url: z.string(), code: z.string(), message: z.string().optional() })),
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

export const SirenCollectionResponseSchema = z.object({
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

export type PageEntry = PageDescriptor & { readonly href: string };

const SirenSortSchema = z.object({
	label: z.string(),
	rel: z.enum(["current", "sort"]),
	order: z.enum(["asc", "desc"]),
	href: z.string(),
});

export type SortEntry = SortDescriptor & { readonly href: string };

const SirenTotalSchema = z.object({ label: z.string() });

function readHrefEntries<T extends { href: string }>(deps: {
	entries: unknown;
	schema: z.ZodType<T>;
	base: string;
}): T[] {
	const parsed = z.array(z.unknown()).safeParse(deps.entries);
	if (!parsed.success) return [];
	return parsed.data.flatMap((entry) => {
		const parsedEntry = deps.schema.safeParse(entry);
		if (!parsedEntry.success) return [];
		const href = resolveHref({ base: deps.base, href: parsedEntry.data.href });
		return href === undefined ? [] : [{ ...parsedEntry.data, href }];
	});
}

export function readPageList(deps: {
	body: SirenCollectionResponse;
	base: string;
}): PageEntry[] {
	return readHrefEntries({ entries: deps.body.properties?.pages, schema: SirenPageSchema, base: deps.base });
}

export function readSortList(deps: {
	body: SirenCollectionResponse;
	base: string;
}): SortEntry[] {
	return readHrefEntries({ entries: deps.body.properties?.sort, schema: SirenSortSchema, base: deps.base });
}

export function readTotal(body: SirenCollectionResponse): CollectionTotal | undefined {
	const parsed = SirenTotalSchema.safeParse(body.properties?.total);
	return parsed.success ? { label: parsed.data.label } : undefined;
}

export const UploadSlotResponseSchema = z.object({
	actions: lenientArray(SirenActionSchema),
});

export function extractCollectionWarning(
	body: SirenCollectionResponse,
): SaveWarning | undefined {
	const warning = body.properties?.warning;
	if (warning === undefined) return undefined;
	const parsed = SirenWarningSchema.safeParse(warning);
	return parsed.success ? parsed.data : undefined;
}

export type SirenCollectionResponse = z.infer<typeof SirenCollectionResponseSchema>;
