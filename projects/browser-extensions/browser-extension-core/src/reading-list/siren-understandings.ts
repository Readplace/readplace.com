import "../zod-config";
import { z } from "zod";
import type { Logger } from "@packages/logger";
import { assert } from "../invariant";
import type { SaveWarning } from "./reading-list.types";
import { base64ToBytes, capturedContentBody } from "./content-body-parsers";
import {
	resolveHref,
	throwIfBlocked,
	SirenCollectionResponseSchema,
	extractCollectionWarning,
	readSirenBody,
	SirenSubEntitySchema,
	readMessages,
	SaveArticlesResultSchema,
	SirenErrorSchema,
	type SirenAction,
	assertMutationOk,
	readPageList,
	readTotal,
	readSortList,
} from "./siren-wire";
import type {
	NavigationResult,
	ActionHandler,
	ActionContext,
	BoundAction,
} from "./siren-navigation.types";

/** Thrown when the server rejects a save by returning the current collection
 * (e.g. for non-saveable URL schemes). Carries the items so the caller can
 * drop the user back into the list view without a re-fetch. The optional
 * `warning` carries the server-authored human-readable reason so the popup
 * can surface it next to the list. */
export class NotSaveableError extends Error {
	constructor(
		public readonly collection: NavigationResult,
		public readonly warning?: SaveWarning,
	) {
		super("URL not saveable");
	}
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
			return { items: [item], actions: {}, descriptors: {}, pages: [], total: undefined, sorts: [], followPage: followPageWith(context), messages: readMessages(body) };
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
			const actionUrl = resolveHref({ base: context.serverUrl, href: sirenAction.href });
			assert(actionUrl, "save-articles action href is not actionable");
			const response = await context.doFetch(
				actionUrl,
				{
					method: sirenAction.method,
					body: formData,
				},
			);
			assert(response.ok, `Bulk save failed: ${response.status}`);
			const body = SaveArticlesResultSchema.parse(await readSirenBody(response));
			return { items: [], actions: {}, descriptors: {}, pages: [], total: undefined, sorts: [], followPage: followPageWith(context), messages: [], bulk: body.properties };
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
	logger: Logger;
	fallbackFields: Record<string, string>;
}): Promise<NavigationResult> {
	const { response, context, logger, fallbackFields } = args;
	const errorJson = await response.json().catch(() => null);
	throwIfBlocked(errorJson);
	const errorParsed = SirenErrorSchema.safeParse(errorJson);
	assert(errorParsed.success, `Save failed: ${response.status}`);
	const errorActions = errorParsed.data.actions;
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
	return { items: [fallbackItem], actions: {}, descriptors: {}, pages: [], total: undefined, sorts: [], followPage: followPageWith(context), messages: [] };
}

export function initSaveContentUnderstanding(deps: {
	logger: Logger;
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
			return { items: [item], actions: {}, descriptors: {}, pages: [], total: undefined, sorts: [], followPage: followPageWith(context), messages: readMessages(responseBody) };
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
					total: undefined,
					sorts: [],
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
				total: readTotal(body),
				sorts: readSortList({ body, base: context.serverUrl }),
				followPage: followPageWith(context),
				messages: [],
			};
		};
	});
	return handlers;
}

export function followPageWith(context: ActionContext): (href: string) => Promise<NavigationResult> {
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
