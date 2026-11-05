import assert from "node:assert/strict";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { initExtension, type ExtensionDeps } from "./siren-walker";
import {
	groupOf,
	initSaveArticleUnderstanding,
	initListArticlesUnderstanding,
} from "./siren-understandings";
import { httpCacheable } from "./siren-fetch";

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
						total: undefined,
						sorts: [],
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

		it("hands the refresh the access token the refused request carried", async () => {
			const SEARCH_ROUTE =
				"GET http://localhost:3000/queue?url=https%3A%2F%2Fexample.com%2Farticle";
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": {
						status: 200,
						body: collectionResponse(),
					},
					[SEARCH_ROUTE]: { status: 401 },
				}),
			);
			const refusedTokens: string[] = [];
			const start = initExtension(createUnderstandings(), {
				...createDeps(fetchFn),
				getAccessToken: async () => "stale-token",
				refreshTokens: async (refused) => {
					refusedTokens.push(refused.refusedAccessToken);
					return { ok: false, reason: "unavailable" };
				},
			});
			const collection = await start();

			await collection.actions
				.search({ url: "https://example.com/article" })
				.catch(() => undefined);

			expect(refusedTokens).toEqual(["stale-token"]);
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

		it("keeps the session and fails retryably when the refresh is unavailable on 401", async () => {
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
			const start = initExtension(createUnderstandings(), {
				...createDeps(fetchFn, async () => {
					onUnauthorizedCallCount++;
				}),
				refreshTokens: async () => ({ ok: false, reason: "unavailable" }),
			});
			const collection = await start();

			const rejection = await collection.actions
				.search({ url: "https://example.com/article" })
				.then(() => undefined, (error: unknown) => error);

			expect(rejection).toBeInstanceOf(Error);
			expect(rejection).not.toBeInstanceOf(UnauthorizedError);
			expect(rejection instanceof Error && rejection.message).toMatch(/refresh unavailable/i);
			expect(calls.filter((call) => call === SEARCH_ROUTE)).toHaveLength(1);
			expect(onUnauthorizedCallCount).toBe(0);
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
