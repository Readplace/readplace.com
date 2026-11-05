import { assert } from "../invariant";
import type { RefreshTokens } from "../auth/auth.types";
import {
	SirenSubEntitySchema,
	type SirenAction,
	type SirenCollectionResponse,
	readPageList,
	readTotal,
	readSortList,
	readMessages,
	SirenCollectionResponseSchema,
	readSirenBody,
	resolveHref,
} from "./siren-wire";
import type {
	ActionHandler,
	NavigationResult,
	DoFetch,
	ActionContext,
	ArticleItem,
	BoundAction,
} from "./siren-navigation.types";
import { createAuthorizedFetch, createCachingFetch } from "./siren-fetch";
import { toReadingListItem } from "./siren-items";
import { genericEntityAction, followPageWith } from "./siren-understandings";

export interface ExtensionDeps {
	serverUrl: string;
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: (refusedAccessToken: string) => Promise<void>;
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
			total: readTotal(body),
			sorts: readSortList({ body, base: deps.serverUrl }),
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
