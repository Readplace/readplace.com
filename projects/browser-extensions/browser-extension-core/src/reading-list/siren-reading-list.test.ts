import assert from "node:assert/strict";
import { noopLogger } from "@packages/hutch-logger";
import type { ReadingListItemId } from "../domain/reading-list-item.types";
import type { CollectionPage, LoadPageResult } from "./reading-list.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import {
	initSirenReadingList,
	initExtension,
	initSaveArticleUnderstanding,
	initSaveArticlesUnderstanding,
	initSaveContentUnderstanding,
	initListArticlesUnderstanding,
	groupOf,
	httpCacheable,
	type ExtensionDeps,
	type SirenReadingListDeps,
} from "./siren-reading-list";

const COLLECTION_ACTIONS = [
	{
		name: "save-article",
		href: "/queue",
		method: "POST",
		type: "application/json",
		fields: [{ name: "url", type: "url" }],
	},
	{
		name: "search",
		href: "/queue",
		method: "GET",
		fields: [
			{ name: "status", type: "text" },
			{ name: "url", type: "url" },
		],
	},
];

function collectionResponse(entities: unknown[] = []) {
	return JSON.stringify({
		class: ["collection", "articles"],
		entities,
		links: [{ rel: ["self"], href: "/queue" }],
		actions: COLLECTION_ACTIONS,
	});
}

function collectionPage(page: LoadPageResult): CollectionPage {
	if (!("items" in page)) {
		throw new Error("expected a loaded page, not a lost page list");
	}
	return page;
}

function pagedCollection(params: {
	self: string;
	entities: unknown[];
	pages: { label: string; rel: string; href: string }[];
}) {
	return JSON.stringify({
		class: ["collection", "articles"],
		properties: { pages: params.pages },
		entities: params.entities,
		links: [{ rel: ["self"], href: params.self }],
		actions: COLLECTION_ACTIONS,
	});
}

const LOCK_MESSAGE_HTML =
	'Your account is locked because your email was never verified. Email <a href="mailto:readplace+verification@readplace.com">readplace+verification@readplace.com</a> to restore access.';

/** The Siren error the server returns when a save is refused with messages for
 * the client to render (e.g. a locked account): server-authored messages, and
 * deliberately no code and no action. */
function messageRefusalBody() {
	return JSON.stringify({
		class: ["error"],
		properties: {
			messages: [
				{ type: "warning", content: { type: "text/html", body: LOCK_MESSAGE_HTML } },
			],
		},
	});
}

function articleEntity(overrides: {
	id: string;
	url: string;
	title: string;
	savedAt: string;
	links?: unknown[];
	actions?: unknown[];
}) {
	return {
		class: ["article"],
		rel: ["item"],
		properties: {
			id: overrides.id,
			url: overrides.url,
			title: overrides.title,
			savedAt: overrides.savedAt,
		},
		links: overrides.links ?? [
			{ rel: ["read"], href: `/queue/${overrides.id}/view` },
		],
		actions: overrides.actions ?? [
			{
				name: "update-status",
				href: `/queue/${overrides.id}/status`,
				method: "POST",
			},
		],
	};
}

type Route = {
	status: number;
	body?: string;
	headers?: Record<string, string>;
};
type RouteHandler = Route | ((init?: RequestInit) => Route);

function requestInfoToUrl(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function createRoutingFetch(routes: Record<string, RouteHandler>): {
	fetchFn: ExtensionDeps["fetchFn"];
	calls: string[];
} {
	const calls: string[] = [];
	const fetchFn: ExtensionDeps["fetchFn"] = async (input, init) => {
		const url = requestInfoToUrl(input);
		const method = init?.method ?? "GET";
		const key = `${method} ${url}`;
		calls.push(key);
		const handler = routes[key];
		if (!handler) throw new Error(`Unexpected fetch: ${key}`);
		const route = typeof handler === "function" ? handler(init) : handler;
		/** A conformant server replies in the negotiated Siren media type; default
		 * it for any body-bearing route that doesn't override Content-Type so the
		 * client's media-type gate passes. */
		const headers: Record<string, string> = {
			...(route.body !== undefined
				? { "Content-Type": "application/vnd.siren+json" }
				: {}),
			...route.headers,
		};
		return new Response(route.body ?? null, {
			status: route.status,
			headers,
		});
	};
	return { fetchFn, calls };
}

function withEntryPoint(
	routes: Record<string, RouteHandler>,
): Record<string, RouteHandler> {
	const readlistRoute = routes["GET http://localhost:3000/queue"];
	if (!readlistRoute)
		throw new Error("withEntryPoint requires a GET /queue route");
	return { "GET http://localhost:3000/": readlistRoute, ...routes };
}

function createDeps(
	fetchFn: ExtensionDeps["fetchFn"],
	onUnauthorized: ExtensionDeps["onUnauthorized"] = async () => {},
): ExtensionDeps {
	return {
		serverUrl: "http://localhost:3000",
		getAccessToken: async () => "test-token",
		fetchFn,
		onUnauthorized,
		refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
	};
}

function createUnderstandings() {
	return groupOf(
		initSaveArticleUnderstanding(),
		httpCacheable(initListArticlesUnderstanding()),
	);
}

describe("initExtension", () => {
	describe("start navigation", () => {
		it("should return items with per-entity actions from collection", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items).toHaveLength(1);
			expect(result.items[0].url).toBe("https://example.com/a");
			expect(result.items[0].title).toBe("A");
			expect(result.items[0].id).toBe("1");
			expect(result.items[0].savedAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
			expect(result.items[0].boundActions["update-status"]).toBeDefined();
		});

		it("should bind collection-level actions", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.actions["save-article"]).toBeDefined();
			expect(result.actions.search).toBeDefined();
		});

		it("should use resolved URL for subsequent calls", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			await start();
			await start();
			expect(
				calls.filter((c) => c === "GET http://localhost:3000/"),
			).toHaveLength(1);
			expect(
				calls.filter((c) => c === "GET http://localhost:3000/queue"),
			).toHaveLength(1);
		});

		it("should validate ETag on second navigation", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": (init) => {
						const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");
						if (ifNoneMatch === '"v1"') return { status: 304 };
						return {
							status: 200,
							body: collectionResponse(),
							headers: { etag: '"v1"' },
						};
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const first = await start();
			const second = await start();
			expect(calls).toEqual([
				"GET http://localhost:3000/",
				"GET http://localhost:3000/queue",
			]);
			expect(second.actions["save-article"]).toBeDefined();
			expect(first.items).toEqual(second.items);
		});

		it("should update cache when ETag validation returns new data", async () => {
			let callCount = 0;
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": () => {
						callCount++;
						if (callCount <= 1)
							return {
								status: 200,
								body: collectionResponse(),
								headers: { etag: '"v1"' },
							};
						return {
							status: 200,
							body: collectionResponse([
								articleEntity({
									id: "new",
									url: "https://new.com",
									title: "New",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							]),
							headers: { etag: '"v2"' },
						};
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const first = await start();
			const second = await start();
			expect(first.items).toHaveLength(0);
			expect(second.items).toHaveLength(1);
			expect(second.items[0].url).toBe("https://new.com");
		});

		it("should return empty items when collection has no entities", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items).toEqual([]);
		});

		it("should handle items without read link", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								links: [{ rel: ["self"], href: "/queue/1" }],
							}),
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items[0].links).toEqual([]);
		});

		it("serializes semantic links symmetrically with actions and excludes structural rels", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								links: [
									{ rel: ["self"], href: "/queue/1" },
									{ rel: ["read"], href: "/queue/1/view" },
									{ rel: ["summary"], href: "/queue/1/summary", title: "TL;DR" },
								],
							}),
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items[0].links).toEqual([
				{ rel: "read", href: "http://localhost:3000/queue/1/view" },
				{
					rel: "summary",
					href: "http://localhost:3000/queue/1/summary",
					title: "TL;DR",
				},
			]);
		});

		it("drops a semantic link whose href scheme is unactionable", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								links: [
									{ rel: ["read"], href: "/queue/1/view" },
									{ rel: ["contact"], href: "mailto:ops@example.com" },
								],
							}),
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items[0].links).toEqual([
				{ rel: "read", href: "http://localhost:3000/queue/1/view" },
			]);
		});

		it("should handle absolute URL in self link", async () => {
			const { fetchFn, calls } = createRoutingFetch({
				"GET http://localhost:3000/": {
					status: 200,
					body: JSON.stringify({
						actions: COLLECTION_ACTIONS,
						links: [
							{
								rel: ["self"],
								href: "http://localhost:3000/queue",
							},
						],
					}),
				},
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
			});
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			await start();
			await start();
			expect(calls).toContain("GET http://localhost:3000/queue");
		});

		it("should throw when server returns an error", async () => {
			const { fetchFn } = createRoutingFetch({
				"GET http://localhost:3000/": { status: 500 },
			});
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			await expect(start()).rejects.toThrow(
				"Navigation failed: 500",
			);
		});

		it("should throw when collection has no self link", async () => {
			const { fetchFn } = createRoutingFetch({
				"GET http://localhost:3000/": {
					status: 200,
					body: JSON.stringify({ actions: COLLECTION_ACTIONS }),
				},
			});
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			await expect(start()).rejects.toThrow(
				"Collection response missing self link",
			);
		});

		it("should throw when access token is null", async () => {
			const { fetchFn } = createRoutingFetch({
				"GET http://localhost:3000/": {
					status: 200,
					body: collectionResponse(),
				},
			});
			const deps: ExtensionDeps = {
				serverUrl: "http://localhost:3000",
				getAccessToken: async () => null,
				fetchFn,
				onUnauthorized: async () => {},
				refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
			};
			const start = initExtension(createUnderstandings(), deps);
			await expect(start()).rejects.toThrow(
				"No access token available",
			);
		});

		it("should pass resolveItem context to entity-level action handlers", async () => {
			const expandHandler: Parameters<typeof groupOf>[0] = new Map();
			expandHandler.set("expand", (_sirenAction, context) => {
				return async () => {
					const sub = {
						properties: {
							id: "sub-1",
							url: "https://sub.com",
							title: "Sub",
							savedAt: "2026-01-01T00:00:00.000Z",
						},
					};
					return {
						items: [context.resolveItem(sub)],
						actions: {},
						descriptors: {},
						pages: [],
						followPage: async () => {
							throw new Error("this handler advertises no pages");
						},
						messages: [],
					};
				};
			});
			const handlers = groupOf(expandHandler);
			const { fetchFn } = createRoutingFetch({
				"GET http://localhost:3000/": {
					status: 200,
					body: JSON.stringify({
						entities: [
							{
								properties: {
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								},
								actions: [
									{
										name: "expand",
										href: "/expand",
										method: "POST",
									},
								],
							},
						],
						links: [{ rel: ["self"], href: "/queue" }],
					}),
				},
			});
			const start = initExtension(handlers, createDeps(fetchFn));
			const result = await start();
			const subResult = await result.items[0].boundActions.expand();
			expect(subResult.items[0].url).toBe("https://sub.com");
			expect(subResult.items[0].id).toBe("sub-1");
		});

		it("should handle entities without actions property", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							{
								properties: {
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								},
							},
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items[0].boundActions).toEqual({});
		});

		it("binds an entity action without a bespoke handler through the generic invoker", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							{
								properties: {
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								},
								actions: [
									{
										name: "unknown-action",
										href: "/unknown",
										method: "POST",
									},
								],
							},
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.items[0].boundActions["unknown-action"]).toBeDefined();
		});

		it("should skip collection actions without matching understanding", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: JSON.stringify({
							entities: [],
							links: [{ rel: ["self"], href: "/queue" }],
							actions: [
								{ name: "unknown", href: "/x", method: "GET" },
							],
						}),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const result = await start();
			expect(result.actions.unknown).toBeUndefined();
		});
	});

	describe("save-article action", () => {
		it("should POST to save action href and return saved item", async () => {
			const savedAt = "2026-01-15T10:00:00.000Z";
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/article",
								title: "Article",
								savedAt,
							},
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions["save-article"]({
				url: "https://example.com/article",
			});
			expect(result.items[0].url).toBe("https://example.com/article");
			expect(result.items[0].title).toBe("Article");
			expect(result.items[0].id).toBe("article-1");
			expect(result.items[0].savedAt).toEqual(new Date(savedAt));
			expect(result.items[0].boundActions["update-status"]).toBeDefined();
			expect(calls).toContain("POST http://localhost:3000/queue");
		});

		it("includes the read link descriptor when the save response has a read link", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/article",
								title: "Article",
								savedAt: "2026-01-15T10:00:00.000Z",
							},
							links: [
								{ rel: ["read"], href: "/queue/article-1/view" },
							],
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions["save-article"]({
				url: "https://example.com/article",
			});
			expect(result.items[0].links).toEqual([
				{ rel: "read", href: "http://localhost:3000/queue/article-1/view" },
			]);
		});

		it("should throw when save fails", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": { status: 422 },
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await expect(
				collection.actions["save-article"]({ url: "bad" }),
			).rejects.toThrow("Save failed: 422");
		});

		it("sends Prefer: return=representation on save (RFC 7240)", async () => {
			let capturedPrefer: string | null = null;
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": (init) => {
						capturedPrefer = new Headers(init?.headers).get("Prefer");
						return {
							status: 201,
							body: JSON.stringify({
								class: ["article"],
								properties: {
									id: "article-1",
									url: "https://example.com/article",
									title: "Article",
									savedAt: "2026-01-15T10:00:00.000Z",
								},
							}),
						};
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await collection.actions["save-article"]({
				url: "https://example.com/article",
			});
			assert.equal(capturedPrefer, "return=representation");
		});

		it("should assert when url field is missing", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await expect(
				collection.actions["save-article"](),
			).rejects.toThrow("save-article requires a url field");
		});

		it("should fall back to application/json when save action has no type", async () => {
			const actionsWithoutType = [
				{
					name: "save-article",
					href: "/queue",
					method: "POST",
					fields: [{ name: "url", type: "url" }],
				},
				COLLECTION_ACTIONS[1],
			];
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: JSON.stringify({
							actions: actionsWithoutType,
							links: [{ rel: ["self"], href: "/queue" }],
						}),
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							},
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions["save-article"]({
				url: "https://example.com/a",
			});
			assert.equal(result.items[0].id, "article-1");
		});
	});

	describe("generic entity action invoker", () => {
		function withMarkReadEntity(markRead: RouteHandler) {
			return createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "mark-read",
										href: "/queue/article-1/read",
										method: "POST",
										type: "application/x-www-form-urlencoded",
										fields: [
											{ name: "status", type: "text", value: "read" },
										],
									},
								],
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/read": markRead,
				}),
			);
		}

		it("POSTs the action's href and returns the refreshed collection", async () => {
			const remaining = articleEntity({
				id: "article-2",
				url: "https://example.com/b",
				title: "B",
				savedAt: "2026-01-15T11:00:00.000Z",
			});
			const { fetchFn, calls } = withMarkReadEntity({
				status: 200,
				body: collectionResponse([remaining]),
			});
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.items[0].boundActions["mark-read"]();
			expect(result.items.map((i) => i.url)).toEqual([
				"https://example.com/b",
			]);
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/read",
			);
		});

		it("builds the body from each declared field's server-supplied value, encoded per type", async () => {
			let observedBody = "";
			let observedContentType: string | null = null;
			const { fetchFn } = withMarkReadEntity((init) => {
				observedBody = String(init?.body);
				observedContentType = new Headers(init?.headers).get("Content-Type");
				return { status: 200, body: collectionResponse() };
			});
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			/** Invoked with no caller fields — the (id, name) path supplies none, so
			 * the body must come from the declared field's `value`. */
			await collection.items[0].boundActions["mark-read"]();
			expect(observedContentType).toBe("application/x-www-form-urlencoded");
			expect(observedBody).toBe("status=read");
		});

		it("coerces a numeric field value to its string form when building the body", async () => {
			let observedBody = "";
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "set-priority",
										href: "/queue/article-1/priority",
										method: "POST",
										type: "application/x-www-form-urlencoded",
										fields: [{ name: "priority", type: "number", value: 3 }],
									},
								],
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/priority": (init) => {
						observedBody = String(init?.body);
						return { status: 200, body: collectionResponse() };
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			/** A numeric server value must render/invoke (coerced to "3"), not fail
			 * the whole-affordance parse and drop the control. */
			await collection.items[0].boundActions["set-priority"]();
			expect(observedBody).toBe("priority=3");
		});

		it("posts an empty body for an action that declares no fields", async () => {
			let observedBody: unknown = null;
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "archive",
										href: "/queue/article-1/archive",
										method: "POST",
									},
								],
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/archive": (init) => {
						observedBody = JSON.parse(String(init?.body));
						return { status: 200, body: collectionResponse() };
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await collection.items[0].boundActions.archive();
			expect(observedBody).toEqual({});
		});

		it("throws when the generic action fails", async () => {
			const { fetchFn } = withMarkReadEntity({ status: 404 });
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await expect(
				collection.items[0].boundActions["mark-read"](),
			).rejects.toThrow("mark-read target not found");
		});

		it("does not invoke an action whose href scheme is unactionable", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "mailto-action",
										href: "mailto:ops@example.com",
										method: "POST",
									},
								],
							}),
						]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await expect(
				collection.items[0].boundActions["mailto-action"](),
			).rejects.toThrow("mailto-action action href is not actionable");
		});
	});

	describe("search action", () => {
		it("should GET with url filter param", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{
							status: 200,
							body: collectionResponse([
								articleEntity({
									id: "1",
									url: "https://example.com/article",
									title: "Found",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							]),
						},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions.search({
				url: "https://example.com/article",
			});
			expect(result.items[0].url).toBe("https://example.com/article");
			expect(result.items[0].boundActions["update-status"]).toBeDefined();
			expect(calls).toContain(
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle",
			);
		});

		it("should return empty items when no match", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Fmissing":
						{
							status: 200,
							body: collectionResponse(),
						},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions.search({
				url: "https://example.com/missing",
			});
			expect(result.items).toEqual([]);
		});

		it("should throw UnauthorizedError and call onUnauthorized on 401", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{ status: 401 },
				}),
			);
			let onUnauthorizedCallCount = 0;
			const start = initExtension(
				createUnderstandings(),
				createDeps(fetchFn, async () => {
					onUnauthorizedCallCount++;
				}),
			);
			const collection = await start();
			await expect(
				collection.actions.search({
					url: "https://example.com/article",
				}),
			).rejects.toBeInstanceOf(UnauthorizedError);
			expect(onUnauthorizedCallCount).toBe(1);
		});

		it("should refresh and replay the same request behind the fresh token on 401", async () => {
			const SEARCH_ROUTE =
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle";
			let token = "stale-token";
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					[SEARCH_ROUTE]: (init) =>
						new Headers(init?.headers).get("authorization") === "Bearer fresh-token"
							? {
									status: 200,
									body: collectionResponse([
										articleEntity({
											id: "1",
											url: "https://example.com/article",
											title: "Found",
											savedAt: "2026-01-15T10:00:00.000Z",
										}),
									]),
								}
							: { status: 401 },
				}),
			);
			let onUnauthorizedCallCount = 0;
			const start = initExtension(createUnderstandings(), {
				...createDeps(fetchFn, async () => {
					onUnauthorizedCallCount++;
				}),
				getAccessToken: async () => token,
				refreshTokens: async () => {
					token = "fresh-token";
					return { ok: true };
				},
			});
			const collection = await start();

			const result = await collection.actions.search({
				url: "https://example.com/article",
			});

			expect(result.items.map((item) => item.url)).toEqual([
				"https://example.com/article",
			]);
			expect(calls.filter((call) => call === SEARCH_ROUTE)).toHaveLength(2);
			expect(onUnauthorizedCallCount).toBe(0);
		});

		it("should end the session when the replay behind a refreshed token is still 401", async () => {
			const SEARCH_ROUTE =
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle";
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					[SEARCH_ROUTE]: { status: 401 },
				}),
			);
			let onUnauthorizedCallCount = 0;
			let refreshCallCount = 0;
			const start = initExtension(createUnderstandings(), {
				...createDeps(fetchFn, async () => {
					onUnauthorizedCallCount++;
				}),
				refreshTokens: async () => {
					refreshCallCount++;
					return { ok: true };
				},
			});
			const collection = await start();

			await expect(
				collection.actions.search({ url: "https://example.com/article" }),
			).rejects.toBeInstanceOf(UnauthorizedError);

			expect(calls.filter((call) => call === SEARCH_ROUTE)).toHaveLength(2);
			expect(refreshCallCount).toBe(1);
			expect(onUnauthorizedCallCount).toBe(1);
		});

		it("should return empty items on non-401 server error", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{ status: 500 },
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions.search({
				url: "https://example.com/article",
			});
			expect(result.items).toEqual([]);
		});

		it("should filter with status param", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?status=unread": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await collection.actions.search({ status: "unread" });
			expect(calls).toContain(
				"GET http://localhost:3000/queue?status=unread",
			);
		});

		it("should return empty items when filter response has no entities key", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Fa":
						{
							status: 200,
							body: JSON.stringify({
								links: [{ rel: ["self"], href: "/queue" }],
							}),
						},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.actions.search({
				url: "https://example.com/a",
			});
			expect(result.items).toEqual([]);
		});

		it("should call with no params when fields is undefined", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await collection.actions.search();
			expect(calls).toContain("GET http://localhost:3000/queue");
			expect(calls).toHaveLength(2);
		});
	});
});

describe("save-content action", () => {
	const COLLECTION_ACTIONS_WITH_SAVE_CONTENT = [
		COLLECTION_ACTIONS[0],
		{
			name: "save-content",
			href: "/queue/save-content",
			method: "POST",
			type: "multipart/form-data",
			fields: [
				{ name: "url", type: "url" },
				{ name: "content", type: "file" },
				{ name: "mediaType", type: "text" },
				{ name: "title", type: "text" },
			],
		},
		COLLECTION_ACTIONS[1],
	];

	function collectionWithSaveContentResponse(entities: unknown[] = []) {
		return JSON.stringify({
			class: ["collection", "articles"],
			entities,
			links: [{ rel: ["self"], href: "/queue" }],
			actions: COLLECTION_ACTIONS_WITH_SAVE_CONTENT,
		});
	}

	function articleResponse(savedAt: string) {
		return JSON.stringify({
			class: ["article"],
			properties: {
				id: "article-1",
				url: "https://example.com/article",
				title: "Captured Article",
				savedAt,
			},
			actions: [
				{
					name: "update-status",
					href: "/queue/article-1/status",
					method: "POST",
				},
			],
		});
	}

	function createUnderstandingsWithSaveContent() {
		return groupOf(
			initSaveArticleUnderstanding(),
			initSaveContentUnderstanding({ logger: noopLogger }),
			httpCacheable(initListArticlesUnderstanding()),
		);
	}

	function bytesToBase64(bytes: Uint8Array): string {
		let binary = "";
		for (let i = 0; i < bytes.length; i += 1) {
			binary += String.fromCharCode(bytes[i] as number);
		}
		return btoa(binary);
	}

	it("POSTs binary content with mediaType as multipart/form-data, returns the saved item", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		let capturedBody: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					capturedBody = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
		const result = await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "application/pdf",
			contentBase64: bytesToBase64(pdfBytes),
		});

		expect(result.items[0].url).toBe("https://example.com/article");
		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		assert(capturedBody, "save-content request must carry a FormData body");
		expect(capturedBody.get("url")).toBe("https://example.com/article");
		expect(capturedBody.get("mediaType")).toBe("application/pdf");
		const contentPart = capturedBody.get("content");
		assert(contentPart instanceof Blob, "save-content body must include a content Blob");
		expect(contentPart.type).toBe("application/pdf");
		const roundTripped = new Uint8Array(await contentPart.arrayBuffer());
		expect(Array.from(roundTripped)).toEqual(Array.from(pdfBytes));
	});

	it("POSTs HTML content as bytes via contentBase64 field, returns the saved item", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		let capturedBody: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					capturedBody = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		const htmlBytes = new TextEncoder().encode("<html><body>Hello</body></html>");
		const result = await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "text/html",
			contentBase64: bytesToBase64(htmlBytes),
			title: "Hello Page",
		});

		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		assert(capturedBody, "save-content request must carry a FormData body");
		expect(capturedBody.get("url")).toBe("https://example.com/article");
		expect(capturedBody.get("mediaType")).toBe("text/html");
		expect(capturedBody.get("title")).toBe("Hello Page");
		const contentPart = capturedBody.get("content");
		assert(contentPart instanceof Blob, "save-content body must include a content Blob");
		expect(contentPart.type).toBe("text/html");
		const text = await contentPart.text();
		expect(text).toBe("<html><body>Hello</body></html>");
	});

	it("follows the fallback save-article action from the Siren error body when save-content errors", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const fallbackBodies: (string | undefined)[] = [];
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: {
							code: "content-too-large",
							message: "Content upload exceeded 500 MB",
						},
						actions: [
							{
								name: "save-article",
								href: "/queue",
								method: "POST",
								type: "application/json",
								fields: [{ name: "url", type: "url" }],
							},
						],
					}),
				},
				"POST http://localhost:3000/queue": (init) => {
					fallbackBodies.push(typeof init?.body === "string" ? init.body : undefined);
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		const result = await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "text/html",
			contentBase64: bytesToBase64(new TextEncoder().encode("<html>big content</html>")),
		});

		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		expect(calls).toContain("POST http://localhost:3000/queue");
		expect(fallbackBodies).toHaveLength(1);
		expect(JSON.parse(fallbackBodies[0] ?? "{}")).toEqual({
			url: "https://example.com/article",
		});
	});

	it("keeps a valid fallback action when the error body carries a malformed sibling, so one bad control cannot discard the whole refusal", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "content-too-large", message: "too big" },
						actions: [
							{ name: "broken-action", method: "POST" },
							{
								name: "save-article",
								href: "/queue",
								method: "POST",
								type: "application/json",
								fields: [{ name: "url", type: "url" }],
							},
						],
					}),
				},
				"POST http://localhost:3000/queue": { status: 201, body: articleResponse(savedAt) },
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		const result = await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "text/html",
			contentBase64: bytesToBase64(new TextEncoder().encode("<html>big</html>")),
		});

		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue");
	});

	it("includes title in the fallback body when available", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const fallbackBodies: (string | undefined)[] = [];
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "broken", message: "fallback" },
						actions: [
							{
								name: "save-article",
								href: "/queue",
								method: "POST",
								type: "application/json",
								fields: [{ name: "url", type: "url" }],
							},
						],
					}),
				},
				"POST http://localhost:3000/queue": (init) => {
					fallbackBodies.push(typeof init?.body === "string" ? init.body : undefined);
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "text/html",
			contentBase64: bytesToBase64(new TextEncoder().encode("<html>content</html>")),
			title: "My Title",
		});

		expect(JSON.parse(fallbackBodies[0] ?? "{}")).toEqual({
			url: "https://example.com/article",
			title: "My Title",
		});
	});

	it("surfaces the server's messages and attempts no fallback save", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 403,
					body: messageRefusalBody(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();
		const htmlBytes = new TextEncoder().encode("<html></html>");
		await expect(
			collection.actions["save-content"]({
				url: "https://example.com/article",
				mediaType: "text/html",
				contentBase64: bytesToBase64(htmlBytes),
			}),
		).rejects.toThrow("Save blocked");
		expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
			"POST http://localhost:3000/queue/save-content",
		]);
	});

	it("throws when the save-content POST fails without a fallback action", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": { status: 500 },
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-content"]({
				url: "https://example.com/article",
				mediaType: "text/html",
				contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")),
			}),
		).rejects.toThrow("Save failed: 500");
	});

	it("throws when the Siren error body has no actions field", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "broken", message: "no fallback" },
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-content"]({
				url: "https://example.com/article",
				mediaType: "text/html",
				contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")),
			}),
		).rejects.toThrow("Save failed: 422");
	});

	it("throws when the Siren error body has an empty actions array", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "broken", message: "empty actions" },
						actions: [],
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-content"]({
				url: "https://example.com/article",
				mediaType: "text/html",
				contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")),
			}),
		).rejects.toThrow("Save failed: 422");
	});

	it("defaults the fallback action Content-Type to application/json when it isn't declared on the Siren action", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		let fallbackHeaders: Record<string, string> | undefined;
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveContentResponse(),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 422,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "broken", message: "fallback" },
						actions: [
							{
								name: "save-article",
								href: "/queue",
								method: "POST",
								fields: [{ name: "url", type: "url" }],
							},
						],
					}),
				},
				"POST http://localhost:3000/queue": (init) => {
					fallbackHeaders = (init?.headers as Record<string, string>) ?? undefined;
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveContent(), createDeps(fetchFn));
		const collection = await start();

		const result = await collection.actions["save-content"]({
			url: "https://example.com/article",
			mediaType: "text/html",
			contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")),
		});
		expect(result.items[0].id).toBe("article-1");
		expect(fallbackHeaders?.["Content-Type"]).toBe("application/json");
	});
});

describe("save-articles action", () => {
	const COLLECTION_ACTIONS_WITH_SAVE_ARTICLES = [
		COLLECTION_ACTIONS[0],
		{
			name: "save-articles",
			href: "/queue/save-articles",
			method: "POST",
			type: "multipart/form-data",
			fields: [
				{ name: "manifest", type: "text" },
				{ name: "content", type: "file" },
			],
		},
		COLLECTION_ACTIONS[1],
	];

	function collectionWithSaveArticlesResponse() {
		return JSON.stringify({
			class: ["collection", "articles"],
			entities: [],
			links: [{ rel: ["self"], href: "/queue" }],
			actions: COLLECTION_ACTIONS_WITH_SAVE_ARTICLES,
		});
	}

	function bulkResultResponse(properties: {
		saved: number;
		skipped: number;
		failed: number;
		tooBig: { url: string; mb: number }[];
		skippedUrls: { url: string; code: string }[];
	}) {
		return JSON.stringify({ class: ["save-articles-result"], properties });
	}

	function bytesToBase64(bytes: Uint8Array): string {
		let binary = "";
		for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
		return btoa(binary);
	}

	function createUnderstandingsWithSaveArticles() {
		return groupOf(
			initSaveArticleUnderstanding(),
			initSaveArticlesUnderstanding(),
			httpCacheable(initListArticlesUnderstanding()),
		);
	}

	it("resolves an absolute save-articles href verbatim instead of concatenating it onto the server base, so the server can re-point the action off-host", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: [
							COLLECTION_ACTIONS[0],
							{
								name: "save-articles",
								href: "https://uploads.example.com/bulk",
								method: "POST",
								type: "multipart/form-data",
								fields: [
									{ name: "manifest", type: "text" },
									{ name: "content", type: "file" },
								],
							},
							COLLECTION_ACTIONS[1],
						],
					}),
				},
				"POST https://uploads.example.com/bulk": {
					status: 200,
					body: bulkResultResponse({ saved: 1, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] }),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions["save-articles"]({
			manifest: JSON.stringify([{ url: "https://example.com/a" }]),
		});
		expect(result.bulk).toMatchObject({ saved: 1 });
		expect(calls).toContain("POST https://uploads.example.com/bulk");
	});

	it("refuses a bulk-save reply that is not the negotiated Siren media type, so a captive-portal HTML 200 reads as an unsupported type rather than a decode error", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
				"POST http://localhost:3000/queue/save-articles": {
					status: 200,
					body: "<html>captive portal</html>",
					headers: { "Content-Type": "text/html" },
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-articles"]({
				manifest: JSON.stringify([{ url: "https://example.com/a" }]),
			}),
		).rejects.toThrow("Unsupported media type: text/html");
	});

	it("builds a multipart body — manifest part plus one content part per captured page — and returns the parsed bulk summary", async () => {
		let capturedBody: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
				"POST http://localhost:3000/queue/save-articles": (init) => {
					capturedBody = init?.body instanceof FormData ? init.body : undefined;
					return {
						status: 200,
						body: bulkResultResponse({
							saved: 2,
							skipped: 1,
							failed: 0,
							tooBig: [{ url: "https://example.com/big", mb: 25 }],
							skippedUrls: [{ url: "chrome://x", code: "unsupported_scheme" }],
						}),
					};
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		const htmlBytes = new TextEncoder().encode("<html>captured</html>");
		const manifest = JSON.stringify([
			{ url: "https://example.com/a", title: "A", mediaType: "text/html" },
			{ url: "https://example.com/b" },
		]);
		const result = await collection.actions["save-articles"]({
			manifest,
			"contentBase64-0": bytesToBase64(htmlBytes),
		});
		expect(result.items).toEqual([]);
		expect(result.bulk).toEqual({
			saved: 2,
			skipped: 1,
			failed: 0,
			tooBig: [{ url: "https://example.com/big", mb: 25 }],
			skippedUrls: [{ url: "chrome://x", code: "unsupported_scheme" }],
		});
		expect(calls).toContain("POST http://localhost:3000/queue/save-articles");
		assert(capturedBody, "bulk save must carry a FormData body");
		expect(capturedBody.get("manifest")).toBe(manifest);
		const contentPart = capturedBody.get("content-0");
		assert(contentPart instanceof Blob, "captured page must ride as a content-0 Blob");
		expect(contentPart.type).toBe("text/html");
		expect(await contentPart.text()).toBe("<html>captured</html>");
		// The url-only entry (index 1) carries no content part.
		expect(capturedBody.get("content-1")).toBeNull();
	});

	it("asserts when the manifest field is missing", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-articles"](),
		).rejects.toThrow("save-articles requires a manifest field");
	});

	it("asserts when a manifest entry declares a mediaType but carries no content", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-articles"]({
				manifest: JSON.stringify([{ url: "https://example.com/a", mediaType: "text/html" }]),
			}),
		).rejects.toThrow("declares a mediaType but carries no content");
	});

	it("throws when the bulk save POST fails", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
				"POST http://localhost:3000/queue/save-articles": { status: 500 },
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveArticles(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-articles"]({
				manifest: JSON.stringify([{ url: "https://example.com/a" }]),
			}),
		).rejects.toThrow("Bulk save failed: 500");
	});

	it("throws UnauthorizedError and calls onUnauthorized on 401", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveArticlesResponse(),
				},
				"POST http://localhost:3000/queue/save-articles": { status: 401 },
			}),
		);
		let onUnauthorizedCallCount = 0;
		const start = initExtension(
			createUnderstandingsWithSaveArticles(),
			createDeps(fetchFn, async () => {
				onUnauthorizedCallCount++;
			}),
		);
		const collection = await start();
		await expect(
			collection.actions["save-articles"]({
				manifest: JSON.stringify([{ url: "https://example.com/a" }]),
			}),
		).rejects.toBeInstanceOf(UnauthorizedError);
		expect(onUnauthorizedCallCount).toBe(1);
	});
});

describe("initSirenReadingList capability negotiation", () => {
	function createAdapterDeps(
		fetchFn: SirenReadingListDeps["fetchFn"],
		onUnauthorized: SirenReadingListDeps["onUnauthorized"] = async () => {},
	): SirenReadingListDeps {
		return {
			serverUrl: "http://localhost:3000",
			getAccessToken: async () => "test-token",
			fetchFn,
			onUnauthorized,
			refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
			logger: noopLogger,
			onAdvertisedActions: () => {},
		};
	}

	function articleResponseFor(href: string) {
		return JSON.stringify({
			class: ["article"],
			properties: {
				id: "article-1",
				url: "https://example.com/article",
				title: "Captured Article",
				savedAt: "2026-01-15T10:00:00.000Z",
			},
			links: [{ rel: ["self"], href }],
			actions: [
				{
					name: "update-status",
					href: "/queue/article-1/status",
					method: "POST",
				},
			],
		});
	}

	it("falls back to save-article when the server advertises no save-content", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"POST http://localhost:3000/queue": {
					status: 201,
					body: articleResponseFor("/queue/article-1"),
				},
			}),
		);
		const list = initSirenReadingList(createAdapterDeps(fetchFn));
		const result = await list.saveUrl({
			url: "https://example.com/article",
			title: "Captured Article",
			content: { bytes: new TextEncoder().encode("<html>captured</html>").buffer, mediaType: "text/html" },
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue");
	});

	it("prefers save-content when save-content is advertised and content is provided (PDF)", async () => {
		const COLLECTION_WITH_CONTENT = [
			COLLECTION_ACTIONS[0],
			{
				name: "save-content",
				href: "/queue/save-content",
				method: "POST",
				type: "multipart/form-data",
				fields: [
					{ name: "url", type: "url" },
					{ name: "content", type: "file" },
					{ name: "mediaType", type: "text" },
					{ name: "title", type: "text" },
				],
			},
			COLLECTION_ACTIONS[1],
		];
		let capturedBody: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: COLLECTION_WITH_CONTENT,
					}),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					capturedBody = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201, body: articleResponseFor("/queue/article-1") };
				},
			}),
		);
		const list = initSirenReadingList(createAdapterDeps(fetchFn));
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
		const result = await list.saveUrl({
			url: "https://example.com/x.pdf",
			title: "",
			content: { bytes: pdfBytes, mediaType: "application/pdf" },
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		assert(capturedBody, "save-content request must carry a FormData body");
		expect(capturedBody.get("mediaType")).toBe("application/pdf");
	});

	it("prefers save-content when save-content is advertised and content is provided (HTML)", async () => {
		const COLLECTION_WITH_CONTENT = [
			COLLECTION_ACTIONS[0],
			{
				name: "save-content",
				href: "/queue/save-content",
				method: "POST",
				type: "multipart/form-data",
				fields: [
					{ name: "url", type: "url" },
					{ name: "content", type: "file" },
					{ name: "mediaType", type: "text" },
					{ name: "title", type: "text" },
				],
			},
			COLLECTION_ACTIONS[1],
			COLLECTION_ACTIONS[1],
		];
		let capturedBody: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: COLLECTION_WITH_CONTENT,
					}),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					capturedBody = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201, body: articleResponseFor("/queue/article-1") };
				},
			}),
		);
		const list = initSirenReadingList(createAdapterDeps(fetchFn));
		const result = await list.saveUrl({
			url: "https://example.com/article",
			title: "Test Title",
			content: { bytes: new TextEncoder().encode("<html>captured</html>").buffer, mediaType: "text/html" },
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		assert(capturedBody, "save-content request must carry a FormData body");
		expect(capturedBody.get("mediaType")).toBe("text/html");
		expect(capturedBody.get("title")).toBe("Test Title");
	});

	it("falls back to save-article when save-content is advertised but content is not provided", async () => {
		const COLLECTION_WITH_CONTENT = [
			COLLECTION_ACTIONS[0],
			{
				name: "save-content",
				href: "/queue/save-content",
				method: "POST",
				type: "multipart/form-data",
				fields: [
					{ name: "url", type: "url" },
					{ name: "content", type: "file" },
					{ name: "mediaType", type: "text" },
					{ name: "title", type: "text" },
				],
			},
			COLLECTION_ACTIONS[1],
		];
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: COLLECTION_WITH_CONTENT,
					}),
				},
				"POST http://localhost:3000/queue": {
					status: 201,
					body: articleResponseFor("/queue/article-1"),
				},
			}),
		);
		const list = initSirenReadingList(createAdapterDeps(fetchFn));
		const result = await list.saveUrl({
			url: "https://example.com/article",
			title: "Test",
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue");
		expect(calls).not.toContain("POST http://localhost:3000/queue/save-content");
	});
});

describe("groupOf", () => {
	it("should merge multiple understanding maps", () => {
		const combined = groupOf(
			initSaveArticleUnderstanding(),
			initListArticlesUnderstanding(),
		);
		expect(combined.has("save-article")).toBe(true);
		expect(combined.has("search")).toBe(true);
	});

	it("should throw on duplicate action names", () => {
		expect(() =>
			groupOf(
				initSaveArticleUnderstanding(),
				initSaveArticleUnderstanding(),
			),
		).toThrow("Duplicate action handler: save-article");
	});
});

describe("httpCacheable", () => {
	it("should add ETag caching to understanding handler fetches", async () => {
		let filterCallCount = 0;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Fa":
					() => {
						filterCallCount++;
						if (filterCallCount > 1) return { status: 304 };
						return {
							status: 200,
							body: collectionResponse([
								articleEntity({
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							]),
							headers: { etag: '"f1"' },
						};
					},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const first = await collection.actions.search({
			url: "https://example.com/a",
		});
		const second = await collection.actions.search({
			url: "https://example.com/a",
		});
		expect(first.items).toHaveLength(1);
		expect(second.items).toHaveLength(1);
		expect(calls.filter((c) => c.includes("url="))).toHaveLength(2);
	});

	it("should not cache POST requests", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"POST http://localhost:3000/queue": {
					status: 201,
					body: JSON.stringify({
						class: ["article"],
						properties: {
							id: "article-1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
						},
						actions: [
							{
								name: "update-status",
								href: "/queue/article-1/status",
								method: "POST",
							},
						],
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		await collection.actions["save-article"]({
			url: "https://example.com/a",
		});
		await collection.actions["save-article"]({
			url: "https://example.com/b",
		});
		expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);
	});

	it("should not cache when response has no ETag", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Fa":
					{
						status: 200,
						body: collectionResponse(),
					},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		await collection.actions.search({
			url: "https://example.com/a",
		});
		await collection.actions.search({
			url: "https://example.com/a",
		});
		expect(calls.filter((c) => c.includes("url="))).toHaveLength(2);
	});
});

describe("toReadingListItem error handling", () => {
	it("throws when server response entity has no properties", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([{}]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		await expect(start()).rejects.toThrow(
			"Server response entity missing properties",
		);
	});

	it("degrades an entity missing non-identity fields to a renderable item instead of failing the collection", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						{ properties: { id: "1", url: "https://example.com" } },
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items).toHaveLength(1);
		expect(result.items[0].id).toBe("1");
		expect(result.items[0].url).toBe("https://example.com");
		expect(result.items[0].title).toBe("");
	});
});

describe("initSirenReadingList", () => {
	function createAdapterDeps(
		fetchFn: SirenReadingListDeps["fetchFn"],
		onUnauthorized: SirenReadingListDeps["onUnauthorized"] = async () => {},
	): SirenReadingListDeps {
		return {
			serverUrl: "http://localhost:3000",
			getAccessToken: async () => "test-token",
			fetchFn,
			onUnauthorized,
			refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
			logger: noopLogger,
			onAdvertisedActions: () => {},
		};
	}

	describe("advertised actions", () => {
		it("reports the collection's advertised action names on every walk", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const reported: string[][] = [];
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				onAdvertisedActions: (names) => reported.push(names),
			});

			await list.getItems();

			expect(reported).toEqual([["save-article", "search"]]);
		});
	});

	describe("saveUrl", () => {
		it("should discover collection via entry point, then POST to save-article action", async () => {
			const savedAt = "2026-01-15T10:00:00.000Z";
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
						headers: { etag: '"v1"' },
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/article",
								title: "Article from example.com",
								savedAt,
							},
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "https://example.com/article",
				title: "Ignored",
			});
			assert.equal(result.ok, true, "save should succeed");
			const item = (result as Extract<typeof result, { ok: true }>).item;
			expect(item.url).toBe("https://example.com/article");
			expect(item.title).toBe("Article from example.com");
			expect(item.id).toBe("article-1");
			expect(item.savedAt).toEqual(new Date(savedAt));
			expect(calls[0]).toBe("GET http://localhost:3000/");
		});

		it("includes the read link descriptor when the server returns a read link", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/article",
								title: "Article",
								savedAt: "2026-01-15T10:00:00.000Z",
							},
							links: [
								{ rel: ["read"], href: "/queue/article-1/view" },
							],
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "https://example.com/article",
				title: "Ignored",
			});
			const item = (result as Extract<typeof result, { ok: true }>).item;
			expect(item.links).toEqual([
				{ rel: "read", href: "http://localhost:3000/queue/article-1/view" },
			]);
		});

		it("should throw when server returns an error on save", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": { status: 422 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.saveUrl({ url: "bad-url", title: "Test" }),
			).rejects.toThrow("Save failed: 422");
		});

		it("returns the server's messages when a save is refused", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 403,
						body: messageRefusalBody(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "https://example.com/article",
				title: "Ignored",
			});
			assert(!result.ok, "save should be refused");
			const messages = "messages" in result ? result.messages : undefined;
			assert(messages, "refusal should carry messages");
			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe("warning");
			expect(messages[0].content.type).toBe("text/html");
			expect(messages[0].content.body).toContain("readplace+verification@readplace.com");
		});

		it("accepts a refusal whose media type it can't render rather than failing", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 403,
						body: JSON.stringify({
							class: ["error"],
							properties: {
								messages: [
									{ type: "warning", content: { type: "text/markdown", body: "**locked**" } },
								],
							},
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			/** The envelope still parses (liberal accept) so the refusal surfaces as
			 * messages and the user drops back into the list; the render layer
			 * (`buildMessageView`) is what ignores the unknown media type. The
			 * alternative — rejecting here — would throw a generic "Save failed". */
			const result = await list.saveUrl({ url: "https://example.com/article", title: "Ignored" });
			assert(!result.ok, "save should be refused");
			const messages = "messages" in result ? result.messages : undefined;
			assert(messages, "refusal should still carry the (unrenderable) messages");
			expect(messages[0].content.type).toBe("text/markdown");
		});

		it("returns a not-saveable result with collection items when server rejects with a collection body", async () => {
			const existing = articleEntity({
				id: "article-existing",
				url: "https://example.com/existing",
				title: "Existing",
				savedAt: "2026-01-15T10:00:00.000Z",
			});
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 422,
						body: collectionResponse([existing]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "chrome://newtab/",
				title: "New Tab",
			});
			assert.equal(result.ok, false);
			const notSaveable = result as Extract<typeof result, { reason: "not-saveable" }>;
			expect(notSaveable.reason).toBe("not-saveable");
			expect(notSaveable.items).toHaveLength(1);
			expect(notSaveable.items[0].url).toBe("https://example.com/existing");
		});

		it("propagates the server warning from properties.warning to the caller", async () => {
			const collectionBody = JSON.stringify({
				class: ["collection", "articles"],
				properties: {
					warning: {
						code: "unsupported_scheme",
						message: "Only http and https URLs can be saved",
					},
				},
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: COLLECTION_ACTIONS,
			});
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 422,
						body: collectionBody,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "chrome://newtab/",
				title: "New Tab",
			});
			assert.equal(result.ok, false);
			const warning = (
				result as Extract<typeof result, { reason: "not-saveable" }>
			).warning;
			expect(warning).toEqual({
				code: "unsupported_scheme",
				message: "Only http and https URLs can be saved",
			});
		});

		it("omits the warning when the collection body has no warning property", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 422,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "chrome://newtab/",
				title: "New Tab",
			});
			assert.equal(result.ok, false);
			const warning = (
				result as Extract<typeof result, { reason: "not-saveable" }>
			).warning;
			expect(warning).toBeUndefined();
		});

		it("omits the warning when properties.warning is present but malformed", async () => {
			const collectionBody = JSON.stringify({
				class: ["collection", "articles"],
				properties: {
					warning: { code: 123 },
				},
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: COLLECTION_ACTIONS,
			});
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 422,
						body: collectionBody,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.saveUrl({
				url: "chrome://newtab/",
				title: "New Tab",
			});
			assert.equal(result.ok, false);
			const warning = (
				result as Extract<typeof result, { reason: "not-saveable" }>
			).warning;
			expect(warning).toBeUndefined();
		});

		it("should throw when collection fetch fails during action discovery", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.saveUrl({ url: "https://example.com", title: "Test" }),
			).rejects.toThrow("Navigation failed: 500");
		});

		it("should track a per-item action from a save response for later invocation", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							},
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.saveUrl({ url: "https://example.com/a", title: "A" });
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert.equal(result.ok, true);
			assert.deepEqual(
				(result as Extract<typeof result, { ok: true }>).items.length,
				0,
			);
		});

		it("should validate cached ETag on second save", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": (init) => {
						const ifNoneMatch = new Headers(init?.headers).get(
							"If-None-Match",
						);
						if (ifNoneMatch === '"v1"') return { status: 304 };
						return {
							status: 200,
							body: collectionResponse(),
							headers: { etag: '"v1"' },
						};
					},
					"POST http://localhost:3000/queue": {
						status: 201,
						body: JSON.stringify({
							class: ["article"],
							properties: {
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							},
							actions: [
								{
									name: "update-status",
									href: "/queue/article-1/status",
									method: "POST",
								},
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.saveUrl({ url: "https://example.com/a", title: "A" });
			await list.saveUrl({ url: "https://example.com/b", title: "B" });
			expect(
				calls.filter((c) => c === "GET http://localhost:3000/"),
			).toHaveLength(1);
		});
	});

	describe("invokeAction per-item action path", () => {
		it("should return fresh items from server after invoking the action", async () => {
			const remaining = articleEntity({
				id: "article-2",
				url: "https://example.com/b",
				title: "B",
				savedAt: "2026-01-15T11:00:00.000Z",
			});
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
							remaining,
						]),
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 200,
						body: collectionResponse([remaining]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert.equal(result.ok, true);
			const items = (result as Extract<typeof result, { ok: true }>).items;
			expect(items).toHaveLength(1);
			expect(items[0].url).toBe("https://example.com/b");
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/status",
			);
		});

		it("should fall back to fetching collection when the action is not tracked", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert.equal(result.ok, true);
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/status",
			);
		});

		it("should return not-found when server responds with 404", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 404,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			expect(result).toEqual({ ok: false, reason: "not-found" });
		});

		it("should propagate server errors other than 404", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						]),
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 500,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "update-status" }),
			).rejects.toThrow("update-status failed: 500");
		});

		it("should propagate network errors from the action", async () => {
			const networkError = new Error("Network unreachable");
			const fetchFn: ExtensionDeps["fetchFn"] = async (input, init) => {
				const url = requestInfoToUrl(input);
				const method = init?.method ?? "GET";
				if (
					method === "POST" &&
					url === "http://localhost:3000/queue/article-1/status"
				) {
					throw networkError;
				}
				return new Response(
					collectionResponse([
						articleEntity({
							id: "article-1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
						}),
					]),
					{
						status: 200,
						headers: { "Content-Type": "application/vnd.siren+json" },
					},
				);
			};
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "update-status" }),
			).rejects.toThrow("Network unreachable");
		});

		it("returns not-found when the entity advertises no per-item action", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [],
							}),
						]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.invokeAction({ id: "article-1" as ReadingListItemId, name: "update-status" });
			expect(result).toEqual({ ok: false, reason: "not-found" });
		});

		it("should throw when fallback collection fetch fails", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "update-status" }),
			).rejects.toThrow("Navigation failed: 500");
		});

		it("returns not-found when the fallback collection has no matching entity", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: JSON.stringify({
							actions: COLLECTION_ACTIONS,
							links: [{ rel: ["self"], href: "/queue" }],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.invokeAction({ id: "article-1" as ReadingListItemId, name: "update-status" });
			expect(result).toEqual({ ok: false, reason: "not-found" });
		});

		it("invokeAction invokes the named action and returns the refreshed list", async () => {
			const remaining = articleEntity({
				id: "article-2",
				url: "https://example.com/b",
				title: "B",
				savedAt: "2026-01-15T11:00:00.000Z",
			});
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "mark-read",
										href: "/queue/article-1/read",
										method: "POST",
									},
								],
							}),
							remaining,
						]),
					},
					"POST http://localhost:3000/queue/article-1/read": {
						status: 200,
						body: collectionResponse([remaining]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "mark-read",
			});
			assert.equal(result.ok, true);
			const items = (result as Extract<typeof result, { ok: true }>).items;
			expect(items.map((i) => i.url)).toEqual(["https://example.com/b"]);
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/read",
			);
		});

		it("invokeAction applies update-status via the (id, name) path with the declared value as urlencoded form data", async () => {
			let observedBody = "";
			let observedContentType: string | null = null;
			const remaining = articleEntity({
				id: "article-2",
				url: "https://example.com/b",
				title: "B",
				savedAt: "2026-01-15T11:00:00.000Z",
			});
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "article-1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
								actions: [
									{
										name: "update-status",
										href: "/queue/article-1/status",
										method: "POST",
										type: "application/x-www-form-urlencoded",
										fields: [
											{ name: "status", type: "text", value: "read" },
										],
									},
								],
							}),
							remaining,
						]),
					},
					"POST http://localhost:3000/queue/article-1/status": (init) => {
						observedBody = String(init?.body);
						observedContentType = new Headers(init?.headers).get("Content-Type");
						return { status: 200, body: collectionResponse([remaining]) };
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();
			/** The popup re-invokes by (id, name) only — no field knowledge crosses
			 * the boundary — so the server must still receive status=read, sourced
			 * from the action's declared field value and urlencoded per its type. */
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert.equal(result.ok, true);
			expect(observedContentType).toBe("application/x-www-form-urlencoded");
			expect(observedBody).toBe("status=read");
		});

		it("invokeAction returns not-found for an item the server does not advertise", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.invokeAction({
				id: "ghost" as ReadingListItemId,
				name: "mark-read",
			});
			expect(result).toEqual({ ok: false, reason: "not-found" });
		});
	});

	describe("findByUrl", () => {
		it("should use filter action to find by URL", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
						headers: { etag: '"v1"' },
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{
							status: 200,
							body: collectionResponse([
								articleEntity({
									id: "article-1",
									url: "https://example.com/article",
									title: "Found Article",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							]),
						},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const found = await list.findByUrl("https://example.com/article");
			expect(found?.url).toBe("https://example.com/article");
			expect(found?.title).toBe("Found Article");
		});

		it("should carry the server's browser-capture state onto the found item", async () => {
			const entity = articleEntity({
				id: "article-1",
				url: "https://example.com/article",
				title: "Blocked Article",
				savedAt: "2026-01-15T10:00:00.000Z",
			});
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{
							status: 200,
							body: collectionResponse([
								{
									...entity,
									properties: {
										...entity.properties,
										needsBrowserCapture: true,
									},
								},
							]),
						},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const found = await list.findByUrl("https://example.com/article");

			expect(found?.needsBrowserCapture).toBe(true);
		});

		it("should need no browser capture when the server describes none", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{
							status: 200,
							body: collectionResponse([
								articleEntity({
									id: "article-1",
									url: "https://example.com/article",
									title: "Found Article",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							]),
						},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const found = await list.findByUrl("https://example.com/article");

			expect(found?.needsBrowserCapture).toBe(false);
		});

		it("should return null when no entities match", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Fmissing":
						{
							status: 200,
							body: collectionResponse(),
						},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			expect(
				await list.findByUrl("https://example.com/missing"),
			).toBeNull();
		});

		it("should throw UnauthorizedError and call onUnauthorized on 401 during findByUrl", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{ status: 401 },
				}),
			);
			let onUnauthorizedCallCount = 0;
			const list = initSirenReadingList(
				createAdapterDeps(fetchFn, async () => {
					onUnauthorizedCallCount++;
				}),
			);
			await expect(
				list.findByUrl("https://example.com/article"),
			).rejects.toBeInstanceOf(UnauthorizedError);
			expect(onUnauthorizedCallCount).toBe(1);
		});

		it("should return null when server returns a non-401 error on filter", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle":
						{ status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			expect(
				await list.findByUrl("https://example.com/article"),
			).toBeNull();
		});
	});

	describe("getItems", () => {
		it("should return all items from the collection", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
							articleEntity({
								id: "2",
								url: "https://example.com/b",
								title: "B",
								savedAt: "2026-01-15T11:00:00.000Z",
							}),
						]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const { items } = await list.getItems();
			expect(items.map((i) => i.url)).toEqual([
				"https://example.com/a",
				"https://example.com/b",
			]);
		});

		it("should return empty array when collection is empty", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			expect((await list.getItems()).items).toEqual([]);
		});

		it("should throw when server returns an error", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(list.getItems()).rejects.toThrow(
				"Navigation failed: 500",
			);
		});

		it("publishes the page list without fetching those pages, and serves one when the reader picks it", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [
								articleEntity({
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "next", href: "/queue?page=2" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=2": {
						status: 200,
						body: pagedCollection({
							self: "/queue?page=2",
							entities: [
								articleEntity({
									id: "2",
									url: "https://example.com/b",
									title: "B",
									savedAt: "2026-01-15T11:00:00.000Z",
								}),
							],
							pages: [
								{ label: "1", rel: "prev", href: "/queue?page=1" },
								{ label: "2", rel: "current", href: "/queue?page=2" },
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const first = await list.getItems();
			expect(first.items.map((item) => item.url)).toEqual(["https://example.com/a"]);
			expect(first.pages).toEqual([
				{ label: "1", rel: "current" },
				{ label: "2", rel: "next" },
			]);
			expect(calls).not.toContain("GET http://localhost:3000/queue?page=2");

			const second = collectionPage(await list.loadPage({ index: 1 }));

			expect(second.items.map((item) => item.url)).toEqual(["https://example.com/b"]);
			expect(second.pages).toEqual([
				{ label: "1", rel: "prev" },
				{ label: "2", rel: "current" },
			]);
		});

		it("keeps every page the server advertised, in order, however its states repeat", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue?page=3",
							entities: [],
							pages: [
								{ label: "1", rel: "prev", href: "/queue?page=1" },
								{ label: "2", rel: "prev", href: "/queue?page=2" },
								{ label: "Latest", rel: "current", href: "/queue?page=3" },
								{ label: "4", rel: "next", href: "/queue?page=4" },
								{ label: "5", rel: "next", href: "/queue?page=5" },
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const page = await list.getItems();

			expect(page.pages).toEqual([
				{ label: "1", rel: "prev" },
				{ label: "2", rel: "prev" },
				{ label: "Latest", rel: "current" },
				{ label: "4", rel: "next" },
				{ label: "5", rel: "next" },
			]);
		});

		it("drops a malformed or unactionable page entry and keeps its siblings", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "sideways", href: "/queue?page=2" },
								{ label: "3", rel: "next", href: "mailto:someone@example.com" },
								{ label: "4", rel: "next", href: "http://localhost:3000/queue?page=4" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=4": {
						status: 200,
						body: pagedCollection({
							self: "/queue?page=4",
							entities: [],
							pages: [{ label: "4", rel: "current", href: "/queue?page=4" }],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const page = await list.getItems();
			expect(page.pages).toEqual([
				{ label: "1", rel: "current" },
				{ label: "4", rel: "next" },
			]);

			collectionPage(await list.loadPage({ index: 1 }));
			expect(calls).toContain("GET http://localhost:3000/queue?page=4");
		});

		it("has no pager for a collection the server advertised no pages for", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const page = await list.getItems();
			expect(page.pages).toEqual([]);

			expect(await list.loadPage({ index: 0 })).toEqual({ pageList: "lost" });
			expect(calls).not.toContain("GET http://localhost:3000/queue?page=1");
		});

		it("keeps the reader on the page they have when loading another one fails", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [
								articleEntity({
									id: "1",
									url: "https://example.com/a",
									title: "A",
									savedAt: "2026-01-15T10:00:00.000Z",
								}),
							],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "next", href: "/queue?page=2" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=2": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			await list.getItems();
			const page = collectionPage(await list.loadPage({ index: 1 }));

			expect(page.items.map((item) => item.url)).toEqual(["https://example.com/a"]);
			expect(page.pages).toEqual([
				{ label: "1", rel: "current" },
				{ label: "2", rel: "next" },
			]);
		});

		it("surfaces an expired session while loading a page rather than swallowing it", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "next", href: "/queue?page=2" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=2": { status: 401 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();

			await expect(list.loadPage({ index: 1 })).rejects.toThrow(UnauthorizedError);
		});

		it("reports a lost page list when it holds none, rather than an empty list", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse([]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const page = await list.loadPage({ index: 0 });

			expect(page).toEqual({ pageList: "lost" });
			expect(calls).toEqual([]);
		});

		it("fetches one page at most once when asked for it twice at once", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "next", href: "/queue?page=2" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=2": {
						status: 200,
						body: pagedCollection({
							self: "/queue?page=2",
							entities: [
								articleEntity({
									id: "2",
									url: "https://example.com/b",
									title: "B",
									savedAt: "2026-01-15T11:00:00.000Z",
								}),
							],
							pages: [
								{ label: "1", rel: "prev", href: "/queue?page=1" },
								{ label: "2", rel: "current", href: "/queue?page=2" },
							],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();

			const [first, second] = await Promise.all([
				list.loadPage({ index: 1 }),
				list.loadPage({ index: 1 }),
			]);

			expect(
				calls.filter((call) => call === "GET http://localhost:3000/queue?page=2"),
			).toHaveLength(1);
			expect(collectionPage(first).items.map((item) => item.id)).toEqual(["2"]);
			expect(collectionPage(second).items.map((item) => item.id)).toEqual(["2"]);
		});

		it("shows the page the reader asked for last when an earlier one settles after it", async () => {
			const pageTwo = pagedCollection({
				self: "/queue?page=2",
				entities: [
					articleEntity({
						id: "2",
						url: "https://example.com/b",
						title: "B",
						savedAt: "2026-01-15T11:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "current", href: "/queue?page=2" },
					{ label: "3", rel: "next", href: "/queue?page=3" },
				],
			});
			const pageThree = pagedCollection({
				self: "/queue?page=3",
				entities: [
					articleEntity({
						id: "3",
						url: "https://example.com/c",
						title: "C",
						savedAt: "2026-01-15T09:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "prev", href: "/queue?page=2" },
					{ label: "3", rel: "current", href: "/queue?page=3" },
				],
			});
			let releasePageTwo: () => void = () => {};
			const pageTwoArrives = new Promise<void>((resolve) => {
				releasePageTwo = resolve;
			});
			const { fetchFn: routed } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: pagedCollection({
							self: "/queue",
							entities: [],
							pages: [
								{ label: "1", rel: "current", href: "/queue?page=1" },
								{ label: "2", rel: "next", href: "/queue?page=2" },
								{ label: "3", rel: "next", href: "/queue?page=3" },
							],
						}),
					},
					"GET http://localhost:3000/queue?page=2": { status: 200, body: pageTwo },
					"GET http://localhost:3000/queue?page=3": { status: 200, body: pageThree },
				}),
			);
			const fetchFn: SirenReadingListDeps["fetchFn"] = async (input, init) => {
				if (requestInfoToUrl(input).includes("page=2")) await pageTwoArrives;
				return routed(input, init);
			};
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();

			const pendingTwo = list.loadPage({ index: 1 });
			const three = collectionPage(await list.loadPage({ index: 2 }));
			releasePageTwo();
			const two = collectionPage(await pendingTwo);

			expect(three.items.map((item) => item.id)).toEqual(["3"]);
			expect(two.items.map((item) => item.id)).toEqual(["3"]);
		});

		it("pages on from the mutation's own answer, not from the pages it replaced", async () => {
			const beforeMutation = pagedCollection({
				self: "/queue",
				entities: [
					articleEntity({
						id: "article-1",
						url: "https://example.com/a",
						title: "A",
						savedAt: "2026-01-15T10:00:00.000Z",
					}),
					articleEntity({
						id: "article-2",
						url: "https://example.com/b",
						title: "B",
						savedAt: "2026-01-15T11:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=stale" },
				],
			});
			const afterMutation = pagedCollection({
				self: "/queue",
				entities: [
					articleEntity({
						id: "article-2",
						url: "https://example.com/b",
						title: "B",
						savedAt: "2026-01-15T11:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=fresh" },
				],
			});
			const freshSecondPage = pagedCollection({
				self: "/queue?page=fresh",
				entities: [
					articleEntity({
						id: "article-3",
						url: "https://example.com/c",
						title: "C",
						savedAt: "2026-01-15T09:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "current", href: "/queue?page=fresh" },
				],
			});
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 200, body: beforeMutation },
					"POST http://localhost:3000/queue/article-1/status": {
						status: 200,
						body: afterMutation,
					},
					"GET http://localhost:3000/queue?page=fresh": {
						status: 200,
						body: freshSecondPage,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();

			const invoked = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert(invoked.ok, "the advertised action should apply");
			const second = collectionPage(await list.loadPage({ index: 1 }));

			expect(invoked.items.map((item) => item.id)).toEqual(["article-2"]);
			expect(invoked.pages).toEqual([
				{ label: "1", rel: "current" },
				{ label: "2", rel: "next" },
			]);
			expect(second.items.map((item) => item.id)).toEqual(["article-3"]);
			expect(calls).not.toContain("GET http://localhost:3000/queue?page=stale");
		});

		it("drops a page that lands after a mutation replaced the list", async () => {
			const beforeMutation = pagedCollection({
				self: "/queue",
				entities: [
					articleEntity({
						id: "article-1",
						url: "https://example.com/a",
						title: "A",
						savedAt: "2026-01-15T10:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=stale" },
				],
			});
			const stalePage = pagedCollection({
				self: "/queue?page=stale",
				entities: [
					articleEntity({
						id: "article-9",
						url: "https://example.com/i",
						title: "I",
						savedAt: "2026-01-15T08:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "current", href: "/queue?page=stale" },
				],
			});
			const afterMutation = pagedCollection({
				self: "/queue",
				entities: [
					articleEntity({
						id: "article-2",
						url: "https://example.com/b",
						title: "B",
						savedAt: "2026-01-15T11:00:00.000Z",
					}),
				],
				pages: [{ label: "1", rel: "current", href: "/queue?page=1" }],
			});
			let releaseStalePage: () => void = () => {};
			const stalePageArrives = new Promise<void>((resolve) => {
				releaseStalePage = resolve;
			});
			const { fetchFn: routed } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 200, body: beforeMutation },
					"GET http://localhost:3000/queue?page=stale": {
						status: 200,
						body: stalePage,
					},
					"POST http://localhost:3000/queue/article-1/status": {
						status: 200,
						body: afterMutation,
					},
				}),
			);
			const fetchFn: SirenReadingListDeps["fetchFn"] = async (input, init) => {
				if (requestInfoToUrl(input).includes("page=stale")) await stalePageArrives;
				return routed(input, init);
			};
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();

			const pendingPage = list.loadPage({ index: 1 });
			const invoked = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "update-status",
			});
			assert(invoked.ok, "the advertised action should apply");
			releaseStalePage();
			const page = collectionPage(await pendingPage);

			expect(page.items.map((item) => item.id)).toEqual(["article-2"]);
			expect(page.pages).toEqual([{ label: "1", rel: "current" }]);
		});

		it("re-serves a page from cache when the server answers not-modified", async () => {
			const pageTwoBody = pagedCollection({
				self: "/queue?page=2",
				entities: [
					articleEntity({
						id: "2",
						url: "https://example.com/b",
						title: "B",
						savedAt: "2026-01-15T11:00:00.000Z",
					}),
				],
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "current", href: "/queue?page=2" },
				],
			});
			const firstPageBody = pagedCollection({
				self: "/queue",
				entities: [],
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=2" },
				],
			});
			const sentIfNoneMatch: (string | undefined)[] = [];
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 200, body: firstPageBody },
					"GET http://localhost:3000/queue?page=2": (init) => {
						const headers = init?.headers as Record<string, string> | undefined;
						sentIfNoneMatch.push(headers?.["If-None-Match"]);
						if (headers?.["If-None-Match"] === '"page-2"') return { status: 304 };
						return { status: 200, body: pageTwoBody, headers: { ETag: '"page-2"' } };
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			await list.getItems();
			const first = collectionPage(await list.loadPage({ index: 1 }));
			await list.getItems();
			const again = collectionPage(await list.loadPage({ index: 1 }));

			expect(sentIfNoneMatch).toEqual([undefined, '"page-2"']);
			expect(first.items.map((item) => item.id)).toEqual(["2"]);
			expect(again.items.map((item) => item.id)).toEqual(["2"]);
		});

		it("should throw when save-article action is missing from collection", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: JSON.stringify({
							entities: [],
							links: [{ rel: ["self"], href: "/queue" }],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getItems();
			await expect(
				list.saveUrl({ url: "https://example.com", title: "Test" }),
			).rejects.toThrow(
				'Expected Siren action "save-article" not found in response',
			);
		});

		it("should throw when search action is missing from collection", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: JSON.stringify({
							entities: [],
							actions: [],
							links: [{ rel: ["self"], href: "/queue" }],
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.findByUrl("https://example.com"),
			).rejects.toThrow(
				'Expected Siren action "search" not found in response',
			);
		});
	});

	describe("savePages", () => {
		const COLLECTION_ACTIONS_WITH_SAVE_ARTICLES = [
			COLLECTION_ACTIONS[0],
			{
				name: "save-articles",
				href: "/queue/save-articles",
				method: "POST",
				type: "multipart/form-data",
				fields: [
					{ name: "manifest", type: "text" },
					{ name: "content", type: "file" },
				],
			},
			COLLECTION_ACTIONS[1],
		];

		function collectionWithSaveArticles() {
			return JSON.stringify({
				class: ["collection", "articles"],
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: COLLECTION_ACTIONS_WITH_SAVE_ARTICLES,
			});
		}

		it("discovers the collection, encodes the pages into a multipart body, and returns the bulk summary", async () => {
			let capturedBody: FormData | undefined;
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionWithSaveArticles(),
					},
					"POST http://localhost:3000/queue/save-articles": (init) => {
						capturedBody = init?.body instanceof FormData ? init.body : undefined;
						return {
							status: 200,
							body: JSON.stringify({
								class: ["save-articles-result"],
								properties: {
									saved: 1,
									skipped: 1,
									failed: 0,
									tooBig: [],
									skippedUrls: [{ url: "chrome://x", code: "unsupported_scheme" }],
								},
							}),
						};
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.savePages({
				pages: [
					{ url: "https://example.com/a", title: "A", content: { bytes: new TextEncoder().encode("<html>a</html>").buffer, mediaType: "text/html" } },
					{ url: "chrome://x" },
				],
			});
			expect(result).toEqual({
				saved: 1,
				skipped: 1,
				failed: 0,
				tooBig: [],
				skippedUrls: [{ url: "chrome://x", code: "unsupported_scheme" }],
				failedUrls: [],
				alreadySaved: 0,
				pendingRetry: 0,
				unauthorized: false,
			});
			assert(capturedBody, "savePages must POST a FormData body");
			expect(capturedBody.get("manifest")).toBe(
				JSON.stringify([
					{ url: "https://example.com/a", title: "A", mediaType: "text/html" },
					{ url: "chrome://x" },
				]),
			);
			const contentPart = capturedBody.get("content-0");
			assert(contentPart instanceof Blob, "the captured page rides as a content-0 Blob");
			expect(await contentPart.text()).toBe("<html>a</html>");
			expect(capturedBody.get("content-1")).toBeNull();
		});

		it("asserts when the collection has no save-articles action", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.savePages({ pages: [{ url: "https://example.com/a" }] }),
			).rejects.toThrow('Expected Siren action "save-articles" not found in response');
		});

		it("returns a zero summary without touching the network when the window is empty", async () => {
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionWithSaveArticles(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({ pages: [] });

			expect(result).toEqual({
				saved: 0,
				skipped: 0,
				failed: 0,
				tooBig: [],
				skippedUrls: [],
				failedUrls: [],
				alreadySaved: 0,
				pendingRetry: 0,
				unauthorized: false,
			});
			expect(calls).toEqual([]);
		});
	});

	describe("savePages against server-advertised limits", () => {
		function collectionAdvertising(limits: { maxItems?: number; maxBytes?: number; maxRequestBytes?: number }) {
			const manifestField: Record<string, unknown> = { name: "manifest", type: "text" };
			if (limits.maxItems !== undefined) manifestField.maxItems = limits.maxItems;
			const contentField: Record<string, unknown> = { name: "content", type: "file" };
			if (limits.maxBytes !== undefined) contentField.maxBytes = limits.maxBytes;
			if (limits.maxRequestBytes !== undefined) contentField.maxRequestBytes = limits.maxRequestBytes;
			return JSON.stringify({
				class: ["collection", "articles"],
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: [
					COLLECTION_ACTIONS[0],
					{
						name: "save-articles",
						href: "/queue/save-articles",
						method: "POST",
						type: "multipart/form-data",
						fields: [manifestField, contentField],
					},
					COLLECTION_ACTIONS[1],
				],
			});
		}

		function bulkRoutes(collection: string, onRequest: (body: FormData) => void) {
			return withEntryPoint({
				"GET http://localhost:3000/queue": { status: 200, body: collection },
				"POST http://localhost:3000/queue/save-articles": (init?: RequestInit) => {
					const body = init?.body;
					assert(body instanceof FormData, "save-articles must POST FormData");
					onRequest(body);
					const manifest = JSON.parse(String(body.get("manifest")));
					return {
						status: 200,
						body: JSON.stringify({
							class: ["save-articles-result"],
							properties: {
								saved: manifest.length,
								skipped: 0,
								failed: 0,
								tooBig: [],
								skippedUrls: [],
							},
						}),
					};
				},
			});
		}

		function manifestsOf(requests: FormData[]): unknown[][] {
			return requests.map((body) => JSON.parse(String(body.get("manifest"))));
		}

		it("splits a window into requests of at most the advertised maxItems", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxItems: 2 }), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 5 }, (_v, i) => ({ url: `https://example.com/${i}` })),
			});

			expect(manifestsOf(requests).map((m) => m.length)).toEqual([2, 2, 1]);
			expect(result.saved).toBe(5);
		});

		it("splits a window so each request's captured content fits the advertised maxBytes", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxBytes: 100 }), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 4 }, (_v, i) => ({
					url: `https://example.com/${i}`,
					content: { bytes: new ArrayBuffer(60), mediaType: "text/html" },
				})),
			});

			expect(manifestsOf(requests).map((m) => m.length)).toEqual([1, 1, 1, 1]);
			expect(result.saved).toBe(4);
		});

		it("sends a page whose capture alone exceeds maxBytes url-only, reports it as too big, and warns", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxBytes: 3 * 1024 * 1024 }), (b) => requests.push(b)),
			);
			const warnings: string[] = [];
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			});

			const result = await list.savePages({
				pages: [
					{
						url: "https://oversize.example",
						content: { bytes: new ArrayBuffer(4 * 1024 * 1024), mediaType: "text/html" },
					},
				],
			});

			expect(result.tooBig).toEqual([{ url: "https://oversize.example", mb: 4 }]);
			expect(result.saved).toBe(1);
			expect(manifestsOf(requests)).toEqual([[{ url: "https://oversize.example" }]]);
			const request = requests[0];
			assert(request, "the stripped page still rides in one bulk request");
			expect([...request.keys()]).toEqual(["manifest"]);
			expect(warnings).toEqual([
				`Captured page of ${4 * 1024 * 1024} bytes exceeds the ${3 * 1024 * 1024}-byte bulk upload limit — saving URL-only`,
			]);
		});

		it("keeps the capture of a page sized exactly at the advertised maxBytes", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxBytes: 64 }), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [
					{
						url: "https://atcap.example",
						content: { bytes: new ArrayBuffer(64), mediaType: "text/html" },
					},
				],
			});

			expect(result.tooBig).toEqual([]);
			expect(requests[0]?.get("content-0")).toBeInstanceOf(Blob);
		});

		it("charges manifest bytes against the budget so a huge title cannot sink a full-content sibling", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxBytes: 1024 }), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [
					{
						url: "https://capture.example",
						content: { bytes: new ArrayBuffer(1000), mediaType: "text/html" },
					},
					{ url: "https://big-title.example", title: "t".repeat(2048) },
				],
			});

			expect(manifestsOf(requests).map((m) => m.length)).toEqual([1, 1]);
			expect(result.saved).toBe(2);
		});

		it("never emits an empty request even for a degenerate advertised maxItems of 0", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({ maxItems: 0 }), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
			});

			expect(manifestsOf(requests).map((m) => m.length)).toEqual([1, 1]);
			expect(result.saved).toBe(2);
		});

		it("chunks a window at the legacy 20-page limit when the server advertises no maxItems", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({}), (b) => requests.push(b)),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 30 }, (_v, i) => ({
					url: `https://example.com/${i}`,
					content: { bytes: new ArrayBuffer(1024), mediaType: "text/html" },
				})),
			});

			expect(manifestsOf(requests).map((m) => m.length)).toEqual([20, 10]);
			expect(result.saved).toBe(30);
		});

		it("strips a capture over the legacy 20 MiB budget when the server advertises no maxBytes", async () => {
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(collectionAdvertising({}), (b) => requests.push(b)),
			);
			const warnings: string[] = [];
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			});

			const result = await list.savePages({
				pages: [
					{
						url: "https://legacy-oversize.example",
						content: { bytes: new ArrayBuffer(20 * 1024 * 1024 + 1), mediaType: "text/html" },
					},
				],
			});

			expect(result.tooBig).toEqual([{ url: "https://legacy-oversize.example", mb: 20 }]);
			expect(result.saved).toBe(1);
			const request = requests[0];
			assert(request, "the stripped page still rides in one bulk request");
			expect([...request.keys()]).toEqual(["manifest"]);
			expect(warnings).toEqual([
				`Captured page of ${20 * 1024 * 1024 + 1} bytes exceeds the ${20 * 1024 * 1024}-byte bulk upload limit — saving URL-only`,
			]);
		});

		it("folds a failing request into the failed count and keeps saving the rest", async () => {
			let call = 0;
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 2 }),
					},
					"POST http://localhost:3000/queue/save-articles": () => {
						call += 1;
						if (call === 2) return { status: 500, body: "boom" };
						return {
							status: 200,
							body: JSON.stringify({
								class: ["save-articles-result"],
								properties: { saved: 2, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] },
							}),
						};
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 4 }, (_v, i) => ({ url: `https://example.com/${i}` })),
			});

			expect(result.saved).toBe(2);
			expect(result.failed).toBe(2);
			expect(result.failedUrls).toEqual([
				{ url: "https://example.com/2" },
				{ url: "https://example.com/3" },
			]);
		});

		it("resolves the partial summary when the session dies mid-run, naming every unsent page", async () => {
			let call = 0;
			const { fetchFn, calls } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 2 }),
					},
					"POST http://localhost:3000/queue/save-articles": () => {
						call += 1;
						if (call === 1) {
							return {
								status: 200,
								body: JSON.stringify({
									class: ["save-articles-result"],
									properties: { saved: 2, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] },
								}),
							};
						}
						return { status: 401 };
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 6 }, (_v, i) => ({ url: `https://example.com/tab-${i}` })),
			});

			expect(result).toEqual({
				saved: 2,
				skipped: 0,
				failed: 4,
				tooBig: [],
				skippedUrls: [],
				failedUrls: [
					{ url: "https://example.com/tab-2" },
					{ url: "https://example.com/tab-3" },
					{ url: "https://example.com/tab-4" },
					{ url: "https://example.com/tab-5" },
				],
				alreadySaved: 0,
				pendingRetry: 0,
				unauthorized: true,
			});
			expect(calls.filter((c) => c.startsWith("POST")).length).toBe(2);
		});

		it("still rejects a 401 from the entry point, where nothing was attempted", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 401 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			await expect(
				list.savePages({ pages: [{ url: "https://example.com/a" }] }),
			).rejects.toBeInstanceOf(UnauthorizedError);
		});

		it("folds a server count shortfall into the failed count and names the chunk's pages", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 20 }),
					},
					"POST http://localhost:3000/queue/save-articles": {
						status: 200,
						body: JSON.stringify({
							class: ["save-articles-result"],
							properties: { saved: 2, skipped: 0, failed: 0, tooBig: [], skippedUrls: [] },
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: Array.from({ length: 3 }, (_v, i) => ({ url: `https://example.com/tab-${i}` })),
			});

			expect(result.saved + result.skipped + result.failed).toBe(3);
			expect(result.failedUrls).toEqual([
				{ url: "https://example.com/tab-0" },
				{ url: "https://example.com/tab-1" },
				{ url: "https://example.com/tab-2" },
			]);
		});

		it("counts pages the server reports as merged in alreadySaved", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 20 }),
					},
					"POST http://localhost:3000/queue/save-articles": {
						status: 200,
						body: JSON.stringify({
							class: ["save-articles-result"],
							properties: {
								saved: 2,
								skipped: 0,
								failed: 0,
								tooBig: [],
								skippedUrls: [],
								results: [
									{ url: "https://example.com/tab-0", outcome: "created" },
									{ url: "https://example.com/tab-1", outcome: "merged" },
								],
							},
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [{ url: "https://example.com/tab-0" }, { url: "https://example.com/tab-1" }],
			});

			expect(result.saved).toBe(2);
			expect(result.alreadySaved).toBe(1);
			expect(result.failedUrls).toEqual([]);
		});

		it("names the pages the server itself reports as failed", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 20 }),
					},
					"POST http://localhost:3000/queue/save-articles": {
						status: 200,
						body: JSON.stringify({
							class: ["save-articles-result"],
							properties: {
								saved: 1,
								skipped: 0,
								failed: 1,
								tooBig: [],
								skippedUrls: [],
								results: [
									{ url: "https://example.com/tab-0", outcome: "created" },
									{ url: "https://example.com/tab-1", outcome: "failed" },
								],
							},
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [{ url: "https://example.com/tab-0" }, { url: "https://example.com/tab-1" }],
			});

			expect(result.failed).toBe(1);
			expect(result.failedUrls).toEqual([{ url: "https://example.com/tab-1" }]);
		});

		it("names only the unaccounted pages when a shortfall arrives alongside per-entry results", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 20 }),
					},
					"POST http://localhost:3000/queue/save-articles": {
						status: 200,
						body: JSON.stringify({
							class: ["save-articles-result"],
							properties: {
								saved: 1,
								skipped: 0,
								failed: 0,
								tooBig: [],
								skippedUrls: [],
								results: [{ url: "https://example.com/tab-0", outcome: "created" }],
							},
						}),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [{ url: "https://example.com/tab-0" }, { url: "https://example.com/tab-1" }],
			});

			expect(result.saved + result.skipped + result.failed).toBe(2);
			expect(result.failedUrls).toEqual([{ url: "https://example.com/tab-1" }]);
		});

		it("rejects a 401 on the first save request, where nothing was attempted", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionAdvertising({ maxItems: 2 }),
					},
					"POST http://localhost:3000/queue/save-articles": { status: 401 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			await expect(
				list.savePages({ pages: [{ url: "https://example.com/a" }] }),
			).rejects.toBeInstanceOf(UnauthorizedError);
		});

		it("drops the title of a page whose manifest entry alone cannot fit one request", async () => {
			const requestBudget = 80;
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(
					collectionAdvertising({
						maxItems: 20,
						maxBytes: 64,
						maxRequestBytes: requestBudget + 16 * 1024,
					}),
					(body) => requests.push(body),
				),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [{ url: "https://example.com/a", title: "t".repeat(200) }],
			});

			expect(result.saved).toBe(1);
			expect(result.tooBig).toEqual([]);
			const request = requests[0];
			assert(request, "the title-less page still rides in one bulk request");
			expect(request.get("manifest")).toBe(JSON.stringify([{ url: "https://example.com/a" }]));
		});

		it("saves a page URL-only when its capture plus manifest entry cannot fit one request", async () => {
			const requestBudget = 96;
			const advertisedMaxRequestBytes = requestBudget + 16 * 1024;
			const requests: FormData[] = [];
			const { fetchFn } = createRoutingFetch(
				bulkRoutes(
					collectionAdvertising({ maxItems: 20, maxBytes: 64, maxRequestBytes: advertisedMaxRequestBytes }),
					(body) => requests.push(body),
				),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.savePages({
				pages: [
					{
						url: "https://example.com/at-cap",
						title: "t".repeat(60),
						content: { bytes: new ArrayBuffer(64), mediaType: "text/html" },
					},
				],
			});

			expect(result.saved).toBe(1);
			expect(result.tooBig).toEqual([{ url: "https://example.com/at-cap", mb: 0 }]);
			const request = requests[0];
			assert(request, "the stripped page still rides in one bulk request");
			expect([...request.keys()]).toEqual(["manifest"]);
		});
	});

	describe("saveUrl against the advertised save-content limit", () => {
		function savedArticleResponse() {
			return JSON.stringify({
				class: ["article"],
				properties: {
					id: "article-1",
					url: "https://example.com/doc.pdf",
					title: "Doc",
					savedAt: "2026-01-15T10:00:00.000Z",
				},
				links: [{ rel: ["self"], href: "/queue/article-1" }],
				actions: [],
			});
		}

		function collectionAdvertising(maxBytes?: number) {
			const contentField: Record<string, unknown> = { name: "content", type: "file" };
			if (maxBytes !== undefined) contentField.maxBytes = maxBytes;
			return JSON.stringify({
				class: ["collection", "articles"],
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: [
					COLLECTION_ACTIONS[0],
					{
						name: "save-content",
						href: "/queue/save-content",
						method: "POST",
						type: "multipart/form-data",
						fields: [
							{ name: "url", type: "url" },
							contentField,
							{ name: "mediaType", type: "text" },
							{ name: "title", type: "text" },
						],
					},
					COLLECTION_ACTIONS[1],
				],
			});
		}

		function routes(collection: string) {
			return withEntryPoint({
				"GET http://localhost:3000/queue": { status: 200, body: collection },
				"POST http://localhost:3000/queue/save-content": {
					status: 201,
					body: savedArticleResponse(),
				},
				"POST http://localhost:3000/queue": {
					status: 201,
					body: savedArticleResponse(),
				},
			});
		}

		it("uploads a capture that fits the advertised ceiling", async () => {
			const { fetchFn, calls } = createRoutingFetch(routes(collectionAdvertising(1024)));
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(1024), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		});

		it("saves url-only and warns when the capture exceeds the advertised ceiling", async () => {
			const { fetchFn, calls } = createRoutingFetch(routes(collectionAdvertising(1024)));
			const warnings: string[] = [];
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			});

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(1025), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls.filter((c) => c.startsWith("POST "))).toEqual([
				"POST http://localhost:3000/queue",
			]);
			expect(warnings).toEqual([
				"Captured content of 1025 bytes exceeds the advertised 1024-byte upload limit — saving URL-only",
			]);
		});

		it("uploads whatever it captured when the server advertises no ceiling", async () => {
			const { fetchFn, calls } = createRoutingFetch(routes(collectionAdvertising()));
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(9_999), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toContain("POST http://localhost:3000/queue/save-content");
		});
	});

	describe("saveUrl direct-to-S3 upload slot", () => {
		const UPLOAD_URL = "https://s3.example.test/pending-pdf/doc.pdf?sig=abc";

		function collectionAdvertisingSlot() {
			return JSON.stringify({
				class: ["collection", "articles"],
				entities: [],
				links: [{ rel: ["self"], href: "/queue" }],
				actions: [
					COLLECTION_ACTIONS[0],
					{
						name: "save-content",
						href: "/queue/save-content",
						method: "POST",
						type: "multipart/form-data",
						fields: [
							{ name: "url", type: "url" },
							{ name: "content", type: "file", maxBytes: 1024 },
							{ name: "mediaType", type: "text" },
							{ name: "title", type: "text" },
							{ name: "size", type: "number" },
						],
					},
					COLLECTION_ACTIONS[1],
				],
			});
		}

		function uploadSlotResponse() {
			return JSON.stringify({
				class: ["upload-slot"],
				properties: { expiresAt: "2026-01-15T10:15:00.000Z" },
				actions: [
					{ name: "upload-content", href: UPLOAD_URL, method: "PUT", type: "application/pdf" },
					{
						name: "save-uploaded-content",
						href: "/queue/save-content",
						method: "POST",
						type: "multipart/form-data",
						fields: [
							{ name: "url", type: "url", value: "https://example.com/doc.pdf" },
							{ name: "mediaType", type: "text", value: "application/pdf" },
							{ name: "title", type: "text", value: "Doc" },
							{ name: "uploaded", type: "hidden", value: "true" },
						],
					},
				],
			});
		}

		function savedArticleResponse() {
			return JSON.stringify({
				class: ["article"],
				properties: { id: "article-1", url: "https://example.com/doc.pdf", title: "Doc", savedAt: "2026-01-15T10:00:00.000Z" },
				links: [{ rel: ["self"], href: "/queue/article-1" }],
				actions: [],
			});
		}

		function slotRoutes(overrides: { put?: Route; completion?: Route; slot?: Route } = {}) {
			const captured: { putInit?: RequestInit; slotInit?: RequestInit; completionInit?: RequestInit } = {};
			const routes = withEntryPoint({
				"GET http://localhost:3000/queue": { status: 200, body: collectionAdvertisingSlot() },
				"POST http://localhost:3000/queue/save-content": (init) => {
					const body = init?.body;
					if (body instanceof FormData && body.has("uploaded")) {
						captured.completionInit = init;
						return overrides.completion ?? { status: 201, body: savedArticleResponse() };
					}
					captured.slotInit = init;
					return overrides.slot ?? { status: 200, body: uploadSlotResponse() };
				},
				[`PUT ${UPLOAD_URL}`]: (init) => {
					captured.putInit = init;
					return overrides.put ?? { status: 200 };
				},
				"POST http://localhost:3000/queue": { status: 201, body: savedArticleResponse() },
			});
			return { routes, captured };
		}

		it("requests a slot, PUTs the raw bytes to S3 without auth, and completes the save", async () => {
			const { routes, captured } = slotRoutes();
			const { fetchFn, calls } = createRoutingFetch(routes);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(2048), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toEqual([
				"GET http://localhost:3000/",
				"POST http://localhost:3000/queue/save-content",
				`PUT ${UPLOAD_URL}`,
				"POST http://localhost:3000/queue/save-content",
			]);
			const putHeaders = new Headers(captured.putInit?.headers);
			expect(putHeaders.get("authorization")).toBeNull();
			expect(putHeaders.get("content-type")).toBe("application/pdf");
			expect(captured.putInit?.body).toBeInstanceOf(ArrayBuffer);
			const slotHeaders = new Headers(captured.slotInit?.headers);
			expect(slotHeaders.get("authorization")).toBe("Bearer test-token");
		});

		it("falls back to a URL-only save when the presigned PUT fails, naming the leg and S3's reason", async () => {
			const { routes } = slotRoutes({
				put: {
					status: 500,
					body: "<Error><Code>InternalError</Code></Error>",
					headers: { "Content-Type": "application/xml" },
				},
			});
			const warnings: string[] = [];
			const { fetchFn, calls } = createRoutingFetch(routes);
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			});

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(2048), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toContain("POST http://localhost:3000/queue");
			expect(
				warnings.some(
					(w) =>
						w.includes("Upload-slot save failed") &&
						w.includes("upload-content failed: 500 <Error><Code>InternalError</Code></Error>"),
				),
			).toBe(true);
		});

		it("falls back to a URL-only save when the completion fails", async () => {
			const { routes } = slotRoutes({ completion: { status: 500, body: JSON.stringify({ properties: { code: "x", message: "y" } }) } });
			const warnings: string[] = [];
			const { fetchFn, calls } = createRoutingFetch(routes);
			const list = initSirenReadingList({
				...createAdapterDeps(fetchFn),
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			});

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(2048), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toContain("POST http://localhost:3000/queue");
			expect(
				warnings.some((w) => w.includes("save-uploaded-content failed: 500")),
			).toBe(true);
		});

		it("falls back to a URL-only save when the slot request is refused", async () => {
			const { routes } = slotRoutes({ slot: { status: 422, body: JSON.stringify({ properties: { code: "content-too-large", message: "too big" } }) } });
			const { fetchFn, calls } = createRoutingFetch(routes);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));

			const result = await list.saveUrl({
				url: "https://example.com/doc.pdf",
				title: "Doc",
				content: { bytes: new ArrayBuffer(2048), mediaType: "application/pdf" },
			});

			assert.equal(result.ok, true);
			expect(calls).toContain("POST http://localhost:3000/queue");
		});
	});

	describe("authHeaders error handling", () => {
		it("throws when access token is null", async () => {
			const { fetchFn } = createRoutingFetch({
				"GET http://localhost:3000/": {
					status: 200,
					body: collectionResponse(),
				},
			});
			const deps: SirenReadingListDeps = {
				serverUrl: "http://localhost:3000",
				getAccessToken: async () => null,
				fetchFn,
				onUnauthorized: async () => {},
				refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
				logger: noopLogger,
				onAdvertisedActions: () => {},
			};
			const list = initSirenReadingList(deps);
			await expect(list.getItems()).rejects.toThrow(
				"No access token available",
			);
		});
	});
});

describe("hypermedia conformance", () => {
	it("renders an unsupported-media-type failure instead of blind-decoding a non-Siren response", async () => {
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": {
				status: 200,
				body: "<html>a proxy login page</html>",
				headers: { "Content-Type": "text/html" },
			},
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		await expect(start()).rejects.toThrow("Unsupported media type: text/html");
	});

	it("reports (none) when a 200 response carries no Content-Type at all", async () => {
		const fetchFn: ExtensionDeps["fetchFn"] = async () =>
			new Response(null, { status: 200 });
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		await expect(start()).rejects.toThrow("Unsupported media type: (none)");
	});

	it("treats a non-http(s) read href as no read URL (unactionable scheme)", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
							links: [{ rel: ["read"], href: "mailto:reader@example.com" }],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].links).toEqual([]);
	});

	it("uses an absolute read href verbatim rather than concatenating it onto the base", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
							links: [{ rel: ["read"], href: "https://cdn.example.com/read/1" }],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].links).toEqual([
			{ rel: "read", href: "https://cdn.example.com/read/1" },
		]);
	});

	it("degrades an entity whose properties omit url, title and savedAt", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([{ properties: { id: "stub" } }]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].id).toBe("stub");
		expect(result.items[0].url).toBe("");
		expect(result.items[0].title).toBe("");
		expect(result.items[0].savedAt).toEqual(new Date(0));
	});

	it("serializes no action descriptors for an entity with no actions", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
							actions: [],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].actions).toEqual([]);
	});

	it("serializes each advertised action as a {name, title} descriptor on the item", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
							actions: [
								{
									name: "update-status",
									title: "Mark as read",
									href: "/queue/1/status",
									method: "POST",
								},
								{ name: "mark-read", href: "/queue/1/read", method: "POST" },
							],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].actions).toEqual([
			{ name: "update-status", title: "Mark as read" },
			{ name: "mark-read" },
		]);
	});

	it("drops a malformed (hrefless) entity action but keeps the valid ones", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
							actions: [
								{ name: "broken", method: "POST" },
								{ name: "update-status", href: "/queue/1/status", method: "POST" },
							],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].actions.map((a) => a.name)).toEqual(["update-status"]);
	});

	it("leaves an advertised page unfetched until something follows it", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			properties: {
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=2" },
				],
			},
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [{ rel: ["self"], href: "/queue" }],
			actions: COLLECTION_ACTIONS,
		});
		const page2 = JSON.stringify({
			class: ["collection", "articles"],
			properties: {
				pages: [
					{ label: "1", rel: "prev", href: "/queue?page=1" },
					{ label: "2", rel: "current", href: "/queue?page=2" },
				],
			},
			entities: [
				articleEntity({
					id: "2",
					url: "https://example.com/b",
					title: "B",
					savedAt: "2026-01-15T11:00:00.000Z",
				}),
			],
			links: [{ rel: ["self"], href: "/queue?page=2" }],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn, calls } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
			"GET http://localhost:3000/queue?page=2": { status: 200, body: page2 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));

		const result = await start();

		expect(result.items.map((i) => i.id)).toEqual(["1"]);
		expect(result.pages.map((page) => page.href)).toEqual([
			"http://localhost:3000/queue?page=1",
			"http://localhost:3000/queue?page=2",
		]);
		expect(calls).not.toContain("GET http://localhost:3000/queue?page=2");

		const followed = await result.followPage("http://localhost:3000/queue?page=2");

		expect(followed.items.map((i) => i.id)).toEqual(["2"]);
		expect(followed.pages.map((page) => page.rel)).toEqual(["prev", "current"]);
	});

	it("fails loudly when an advertised page cannot be fetched", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			properties: {
				pages: [
					{ label: "1", rel: "current", href: "/queue?page=1" },
					{ label: "2", rel: "next", href: "/queue?page=2" },
				],
			},
			entities: [],
			links: [{ rel: ["self"], href: "/queue" }],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
			"GET http://localhost:3000/queue?page=2": { status: 500 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();

		await expect(
			result.followPage("http://localhost:3000/queue?page=2"),
		).rejects.toThrow("Page load failed: 500");
	});

	it("returns the search's own page list and leaves those pages unfetched", async () => {
		const searchPage = JSON.stringify({
			class: ["collection", "articles"],
			properties: {
				pages: [
					{ label: "1", rel: "current", href: "/queue?url=x&page=1" },
					{ label: "2", rel: "next", href: "/queue?url=x&page=2" },
				],
			},
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [{ rel: ["self"], href: "/queue?url=x" }],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn, calls } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: collectionResponse() },
			"GET http://localhost:3000/queue": { status: 200, body: collectionResponse() },
			"GET http://localhost:3000/queue?url=x": { status: 200, body: searchPage },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const search = collection.actions.search;
		assert(search, "the collection advertises a search action");

		const result = await search({ url: "x" });

		expect(result.items.map((i) => i.id)).toEqual(["1"]);
		expect(result.pages.map((page) => page.href)).toEqual([
			"http://localhost:3000/queue?url=x&page=1",
			"http://localhost:3000/queue?url=x&page=2",
		]);
		expect(calls).not.toContain("GET http://localhost:3000/queue?url=x&page=2");
	});

	it("answers an empty search when the server refuses it", async () => {
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: collectionResponse() },
			"GET http://localhost:3000/queue": { status: 200, body: collectionResponse() },
			"GET http://localhost:3000/queue?url=x": { status: 500 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const search = collection.actions.search;
		assert(search, "the collection advertises a search action");

		const result = await search({ url: "x" });

		expect(result.items).toEqual([]);
		expect(result.pages).toEqual([]);
	});
	it("sends no params for a search action that declares no fields", async () => {
		const fieldlessSearch = [
			COLLECTION_ACTIONS[0],
			{ name: "search", href: "/queue", method: "GET" },
		];
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: fieldlessSearch,
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions.search({ url: "https://example.com/x" });
		expect(result.items).toEqual([]);
		expect(calls).toContain("GET http://localhost:3000/queue");
	});
});

describe("initSirenReadingList deferred content upload", () => {
	const SERVER = "http://localhost:3000";
	const SLOT_UPLOAD_URL = "https://s3.example.test/pending/doc?sig=abc";

	function uploadDeps(
		fetchFn: SirenReadingListDeps["fetchFn"],
		overrides: Partial<SirenReadingListDeps> = {},
	): SirenReadingListDeps {
		return {
			serverUrl: SERVER,
			getAccessToken: async () => "test-token",
			fetchFn,
			onUnauthorized: async () => {},
			refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
			logger: noopLogger,
			onAdvertisedActions: () => {},
			...overrides,
		};
	}

	function collectionAdvertising(saveContentFields?: unknown[]) {
		const actions: unknown[] = [COLLECTION_ACTIONS[0], COLLECTION_ACTIONS[1]];
		if (saveContentFields) {
			actions.push({
				name: "save-content",
				href: "/queue/save-content",
				method: "POST",
				type: "multipart/form-data",
				fields: saveContentFields,
			});
		}
		return JSON.stringify({
			class: ["collection", "articles"],
			entities: [],
			links: [{ rel: ["self"], href: "/queue" }],
			actions,
		});
	}

	const INLINE_FIELDS = [
		{ name: "url", type: "url" },
		{ name: "content", type: "file", maxBytes: 1024 },
		{ name: "mediaType", type: "text" },
		{ name: "title", type: "text" },
	];

	const SLOT_FIELDS = [...INLINE_FIELDS, { name: "size", type: "number" }];

	function uploadSlotResponse() {
		return JSON.stringify({
			class: ["upload-slot"],
			actions: [
				{ name: "upload-content", href: SLOT_UPLOAD_URL, method: "PUT", type: "text/html" },
				{
					name: "save-uploaded-content",
					href: "/queue/save-content",
					method: "POST",
					type: "multipart/form-data",
					fields: [
						{ name: "url", type: "url", value: "https://example.com/a" },
						{ name: "uploaded", type: "hidden", value: "true" },
					],
				},
			],
		});
	}

	it("posts the captured bytes as a multipart part, never a base64 field", async () => {
		let uploaded: FormData | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(INLINE_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					uploaded = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201 };
				},
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		const result = await uploadContent({
			url: "https://example.com/a",
			title: "A",
			content: { bytes: new TextEncoder().encode("<html>a</html>").buffer, mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: true });
		expect(calls[0]).toBe("GET http://localhost:3000/");
		assert(uploaded, "save-content must carry a multipart body");
		expect(uploaded.get("url")).toBe("https://example.com/a");
		expect(uploaded.get("mediaType")).toBe("text/html");
		expect(uploaded.get("title")).toBe("A");
		expect(uploaded.get("contentBase64")).toBeNull();
		const part = uploaded.get("content");
		assert(part instanceof Blob, "content part must be a Blob");
		expect(await part.text()).toBe("<html>a</html>");
	});

	it("omits the title part when the tab had none", async () => {
		let uploaded: FormData | undefined;
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(INLINE_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					uploaded = init?.body instanceof FormData ? init.body : undefined;
					return { status: 201 };
				},
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(8), mediaType: "text/html" },
		});

		assert(uploaded, "save-content must carry a multipart body");
		expect(uploaded.get("title")).toBeNull();
	});

	it("uploads whatever it captured when the server advertises no ceiling", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising([
						{ name: "url", type: "url" },
						{ name: "content", type: "file" },
					]),
				},
				"POST http://localhost:3000/queue/save-content": { status: 201 },
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(9_999), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: true });
		expect(calls).toContain("POST http://localhost:3000/queue/save-content");
	});

	it("takes the presigned slot when the capture is over the advertised ceiling", async () => {
		const captured: { putInit?: RequestInit } = {};
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(SLOT_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": (init) => {
					const body = init?.body;
					if (body instanceof FormData && body.has("uploaded")) return { status: 201 };
					return { status: 200, body: uploadSlotResponse() };
				},
				[`PUT ${SLOT_UPLOAD_URL}`]: (init) => {
					captured.putInit = init;
					return { status: 200 };
				},
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(2048), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: true });
		expect(calls).toEqual([
			"GET http://localhost:3000/",
			"POST http://localhost:3000/queue/save-content",
			`PUT ${SLOT_UPLOAD_URL}`,
			"POST http://localhost:3000/queue/save-content",
		]);
		expect(new Headers(captured.putInit?.headers).get("authorization")).toBeNull();
	});

	it("reports a refused slot request as rejected rather than degrading to a URL-only save", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(SLOT_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": { status: 422, body: "too big" },
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(2048), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: false, reason: "rejected" });
		expect(calls).not.toContain("POST http://localhost:3000/queue");
	});

	it("reports a failed presigned PUT as retryable", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(SLOT_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 200,
					body: uploadSlotResponse(),
				},
				[`PUT ${SLOT_UPLOAD_URL}`]: { status: 503 },
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		await expect(
			uploadContent({
				url: "https://example.com/a",
				content: { bytes: new ArrayBuffer(2048), mediaType: "text/html" },
			}),
		).rejects.toThrow("upload-content failed: 503");
	});

	it("names the leg that ended a failed exchange and carries the store's own explanation", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(SLOT_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": {
					status: 200,
					body: uploadSlotResponse(),
				},
				[`PUT ${SLOT_UPLOAD_URL}`]: {
					status: 503,
					body: "<Error><Code>SlowDown</Code></Error>",
					headers: { "Content-Type": "application/xml" },
				},
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		await expect(
			uploadContent({
				url: "https://example.com/a",
				content: { bytes: new ArrayBuffer(2048), mediaType: "text/html" },
			}),
		).rejects.toThrow("upload-content failed: 503 <Error><Code>SlowDown</Code></Error>");
	});

	it("reports unsupported when the server advertises no save-content action", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": { status: 200, body: collectionAdvertising() },
			}),
		);
		const warnings: string[] = [];
		const { uploadContent } = initSirenReadingList(
			uploadDeps(fetchFn, {
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			}),
		);

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(8), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: false, reason: "unsupported" });
		expect(warnings.some((w) => w.includes("no save-content action"))).toBe(true);
	});

	it("reports unsupported when the capture is over the ceiling and no slot is advertised", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(INLINE_FIELDS),
				},
			}),
		);
		const warnings: string[] = [];
		const { uploadContent } = initSirenReadingList(
			uploadDeps(fetchFn, {
				logger: { ...noopLogger, warn: (m: unknown) => warnings.push(String(m)) },
			}),
		);

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(2048), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: false, reason: "unsupported" });
		expect(warnings.some((w) => w.includes("advertises no upload slot"))).toBe(true);
	});

	it("reports a 4xx refusal as rejected", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(INLINE_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": { status: 415, body: "nope" },
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		const result = await uploadContent({
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(8), mediaType: "text/html" },
		});

		expect(result).toEqual({ ok: false, reason: "rejected" });
	});

	it("throws on a server-side failure so the caller can back off", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionAdvertising(INLINE_FIELDS),
				},
				"POST http://localhost:3000/queue/save-content": { status: 500 },
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		await expect(
			uploadContent({
				url: "https://example.com/a",
				content: { bytes: new ArrayBuffer(8), mediaType: "text/html" },
			}),
		).rejects.toThrow("save-content failed: 500");
	});

	it("asserts when the advertised save-content href is not actionable", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: JSON.stringify({
						class: ["collection", "articles"],
						entities: [],
						links: [{ rel: ["self"], href: "/queue" }],
						actions: [
							COLLECTION_ACTIONS[0],
							{
								name: "save-content",
								href: "mailto:ops@example.com",
								method: "POST",
								fields: INLINE_FIELDS,
							},
						],
					}),
				},
			}),
		);
		const { uploadContent } = initSirenReadingList(uploadDeps(fetchFn));

		await expect(
			uploadContent({
				url: "https://example.com/a",
				content: { bytes: new ArrayBuffer(8), mediaType: "text/html" },
			}),
		).rejects.toThrow("save-content action href is not actionable");
	});
});


/** The reader's readlist is not a dependency of saving to it. A save fetched every
 * page of the readlist twice before this budget existed — the walker collected all
 * pages eagerly, and a save walks twice — which is why the cost is asserted as
 * an exact request list rather than a maximum. Anything that reintroduces a
 * collection read here shows up as an extra entry. */
describe("initSirenReadingList request budget", () => {
	function budgetDeps(
		fetchFn: SirenReadingListDeps["fetchFn"],
	): SirenReadingListDeps {
		return {
			serverUrl: "http://localhost:3000",
			getAccessToken: async () => "test-token",
			fetchFn,
			onUnauthorized: async () => {},
			refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
			logger: noopLogger,
			onAdvertisedActions: () => {},
		};
	}

	it("spends one entry-point walk and the save itself, and never reads the readlist", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "1",
							url: "https://example.com/a",
							title: "A",
							savedAt: "2026-01-15T10:00:00.000Z",
						}),
					]),
				},
				"POST http://localhost:3000/queue": {
					status: 201,
					body: JSON.stringify(
						articleEntity({
							id: "2",
							url: "https://example.com/b",
							title: "B",
							savedAt: "2026-01-15T11:00:00.000Z",
						}),
					),
				},
			}),
		);
		const { saveUrl } = initSirenReadingList(budgetDeps(fetchFn));

		const result = await saveUrl({ url: "https://example.com/b", title: "B" });

		expect(result.ok).toBe(true);
		expect(calls).toEqual([
			"GET http://localhost:3000/",
			"POST http://localhost:3000/queue",
		]);
	});

	it("reads one page to show the list, and one more only when asked for another", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: pagedCollection({
						self: "/queue",
						entities: [
							articleEntity({
								id: "1",
								url: "https://example.com/a",
								title: "A",
								savedAt: "2026-01-15T10:00:00.000Z",
							}),
						],
						pages: [
							{ label: "1", rel: "current", href: "/queue?page=1" },
							{ label: "2", rel: "next", href: "/queue?page=2" },
						],
					}),
				},
				"GET http://localhost:3000/queue?page=2": {
					status: 200,
					body: collectionResponse([
						articleEntity({
							id: "2",
							url: "https://example.com/b",
							title: "B",
							savedAt: "2026-01-15T09:00:00.000Z",
						}),
					]),
				},
			}),
		);
		const { getItems, loadPage } = initSirenReadingList(budgetDeps(fetchFn));

		const first = await getItems();
		expect(first.items).toHaveLength(1);
		expect(calls).toEqual(["GET http://localhost:3000/"]);

		const second = collectionPage(await loadPage({ index: 1 }));
		expect(second.items).toHaveLength(1);
		expect(calls).toEqual([
			"GET http://localhost:3000/",
			"GET http://localhost:3000/queue?page=2",
		]);
	});
});
