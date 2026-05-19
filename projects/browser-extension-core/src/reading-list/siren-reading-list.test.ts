import assert from "node:assert/strict";
import type { ReadingListItemId } from "../domain/reading-list-item.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import {
	initSirenReadingList,
	initExtension,
	initSaveArticleUnderstanding,
	initSaveHtmlUnderstanding,
	initDeleteArticleUnderstanding,
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

const COLLECTION_ACTIONS_WITH_SAVE_HTML = [
	COLLECTION_ACTIONS[0],
	{
		name: "save-html",
		href: "/queue/save-html",
		method: "POST",
		type: "application/json",
		fields: [
			{ name: "url", type: "url" },
			{ name: "rawHtml", type: "text" },
			{ name: "title", type: "text" },
		],
	},
	COLLECTION_ACTIONS[1],
];

function collectionWithSaveHtmlResponse(entities: unknown[] = []) {
	return JSON.stringify({
		class: ["collection", "articles"],
		entities,
		links: [{ rel: ["self"], href: "/queue" }],
		actions: COLLECTION_ACTIONS_WITH_SAVE_HTML,
	});
}

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
				name: "delete",
				href: `/queue/${overrides.id}/delete`,
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
		return new Response(route.body ?? null, {
			status: route.status,
			headers: route.headers,
		});
	};
	return { fetchFn, calls };
}

function withEntryPoint(
	routes: Record<string, RouteHandler>,
): Record<string, RouteHandler> {
	const queueRoute = routes["GET http://localhost:3000/queue"];
	if (!queueRoute)
		throw new Error("withEntryPoint requires a GET /queue route");
	return { "GET http://localhost:3000/": queueRoute, ...routes };
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
	};
}

function createUnderstandings() {
	return groupOf(
		initSaveArticleUnderstanding(),
		initDeleteArticleUnderstanding(),
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
			expect(result.items[0].readUrl).toBe("http://localhost:3000/queue/1/view");
			expect(result.items[0].actions.delete).toBeDefined();
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
			expect(result.items[0].readUrl).toBeUndefined();
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
					return { items: [context.resolveItem(sub)], actions: {} };
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
			const subResult = await result.items[0].actions.expand();
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
			expect(result.items[0].actions).toEqual({});
		});

		it("should skip entity actions without matching understanding", async () => {
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
			expect(result.items[0].actions["unknown-action"]).toBeUndefined();
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
									name: "delete",
									href: "/queue/article-1/delete",
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
			expect(result.items[0].actions.delete).toBeDefined();
			expect(calls).toContain("POST http://localhost:3000/queue");
		});

		it("should include readUrl when save response has read link", async () => {
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
									name: "delete",
									href: "/queue/article-1/delete",
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
			expect(result.items[0].readUrl).toBe(
				"http://localhost:3000/queue/article-1/view",
			);
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

		it("sends Prefer: return=representation to opt into the collection-on-rejection flow", async () => {
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
									name: "delete",
									href: "/queue/article-1/delete",
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

	describe("delete action", () => {
		it("should POST to delete href and return refreshed collection", async () => {
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.items[0].actions.delete();
			expect(result.items).toEqual([]);
			expect(result.actions["save-article"]).toBeDefined();
			expect(result.actions.search).toBeDefined();
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/delete",
			);
		});

		it("should return items from server after delete", async () => {
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
							}),
							remaining,
						]),
					},
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 200,
						body: collectionResponse([remaining]),
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			const result = await collection.items[0].actions.delete();
			expect(result.items).toHaveLength(1);
			expect(result.items[0].url).toBe("https://example.com/b");
			expect(result.items[0].actions.delete).toBeDefined();
		});

		it("should throw when delete fails", async () => {
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 404,
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await expect(
				collection.items[0].actions.delete(),
			).rejects.toThrow("Delete failed: 404");
		});

		/** Without this header the server falls back to a 204 No Content response to keep chrome-extension v1.0.66 (still in the web store) working — that build can only observe 204s because it sets `redirect: "manual"`, which masks 303 status codes as opaqueredirect/0. */
		it("sends Prefer: return=representation so the server returns the refreshed Siren collection (and not the v1.0.66 backwards-compat 204)", async () => {
			let observedPrefer: string | null = null;
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
					"POST http://localhost:3000/queue/article-1/delete": (init) => {
						const headers = (init?.headers ?? {}) as Record<string, string>;
						observedPrefer = headers.Prefer ?? null;
						return { status: 200, body: collectionResponse() };
					},
				}),
			);
			const start = initExtension(createUnderstandings(), createDeps(fetchFn));
			const collection = await start();
			await collection.items[0].actions.delete();
			expect(observedPrefer).toBe("return=representation");
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
			expect(result.items[0].actions.delete).toBeDefined();
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

describe("save-html action", () => {
	function createUnderstandingsWithSaveHtml() {
		return groupOf(
			initSaveArticleUnderstanding(),
			initSaveHtmlUnderstanding(),
			initDeleteArticleUnderstanding(),
			httpCacheable(initListArticlesUnderstanding()),
		);
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
					name: "delete",
					href: "/queue/article-1/delete",
					method: "POST",
				},
			],
		});
	}

	it("POSTs to the save-html action with url + rawHtml + title and returns the saved item", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		let capturedBody: string | undefined;
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": (init) => {
					capturedBody = typeof init?.body === "string" ? init.body : undefined;
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>captured</html>",
			title: "Captured Article",
		});
		expect(result.items[0].url).toBe("https://example.com/article");
		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue/save-html");
		expect(capturedBody).toBe(JSON.stringify({
			url: "https://example.com/article",
			rawHtml: "<html>captured</html>",
			title: "Captured Article",
		}));
	});

	it("omits the title field from the body when not provided", async () => {
		let capturedBody: string | undefined;
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": (init) => {
					capturedBody = typeof init?.body === "string" ? init.body : undefined;
					return { status: 201, body: articleResponse("2026-01-15T10:00:00.000Z") };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>captured</html>",
		});
		expect(capturedBody).toBe(JSON.stringify({
			url: "https://example.com/article",
			rawHtml: "<html>captured</html>",
		}));
	});

	it("throws when the save-html POST fails", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": { status: 422 },
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ url: "https://example.com/article", rawHtml: "<html>x</html>" }),
		).rejects.toThrow("Save failed: 422");
	});

	it("follows the fallback save-article action from the Siren error body when save-html errors", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const fallbackBodies: (string | undefined)[] = [];
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 500,
					body: JSON.stringify({
						class: ["error"],
						properties: {
							code: "html-too-large",
							message: "Submitting the HTML of this page has failed due to being too large exceeding 10MB",
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
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>captured</html>",
			title: "Captured Article",
		});
		expect(result.items[0].id).toBe("article-1");
		expect(calls).toContain("POST http://localhost:3000/queue/save-html");
		expect(calls).toContain("POST http://localhost:3000/queue");
		expect(fallbackBodies[0]).toBe(
			JSON.stringify({ url: "https://example.com/article", title: "Captured Article" }),
		);
	});

	it("throws when the save-html error body has no actions field at all", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 500,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "save-failed", message: "Could not save article" },
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ url: "https://example.com/article", rawHtml: "<html>x</html>" }),
		).rejects.toThrow("Save failed: 500");
	});

	it("throws when the save-html error body carries an empty actions array", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 500,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "save-failed", message: "Could not save article" },
						actions: [],
					}),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ url: "https://example.com/article", rawHtml: "<html>x</html>" }),
		).rejects.toThrow("Save failed: 500");
	});

	it("defaults Content-Type to application/json when the fallback action has no type", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const fallbackHeaders: Record<string, string>[] = [];
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 500,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "html-too-large", message: "too big" },
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
					fallbackHeaders.push((init?.headers ?? {}) as Record<string, string>);
					return { status: 201, body: articleResponse(savedAt) };
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>x</html>",
		});
		expect(fallbackHeaders[0]["Content-Type"]).toBe("application/json");
	});

	it("omits title from the fallback body when the original save-html call had no title", async () => {
		const savedAt = "2026-01-15T10:00:00.000Z";
		const fallbackBodies: (string | undefined)[] = [];
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 500,
					body: JSON.stringify({
						class: ["error"],
						properties: { code: "html-too-large", message: "too big" },
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
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>x</html>",
		});
		expect(fallbackBodies[0]).toBe(
			JSON.stringify({ url: "https://example.com/article" }),
		);
	});

	it("asserts when the url field is missing", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ rawHtml: "<html>x</html>" }),
		).rejects.toThrow("save-html requires a url field");
	});

	it("asserts when the rawHtml field is missing", async () => {
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ url: "https://example.com/article" }),
		).rejects.toThrow("save-html requires a rawHtml field");
	});

	it("falls back to application/json when the action has no type", async () => {
		const actionsWithoutType = [
			COLLECTION_ACTIONS[0],
			{
				name: "save-html",
				href: "/queue/save-html",
				method: "POST",
				fields: [
					{ name: "url", type: "url" },
					{ name: "rawHtml", type: "text" },
				],
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
				"POST http://localhost:3000/queue/save-html": {
					status: 201,
					body: articleResponse("2026-01-15T10:00:00.000Z"),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions["save-html"]({
			url: "https://example.com/article",
			rawHtml: "<html>x</html>",
		});
		assert.equal(result.items[0].id, "article-1");
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
					name: "delete",
					href: "/queue/article-1/delete",
					method: "POST",
				},
			],
		});
	}

	it("prefers save-html when rawHtml is provided AND the server advertises save-html", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 201,
					body: articleResponseFor("/queue/article-1"),
				},
			}),
		);
		const list = initSirenReadingList(createAdapterDeps(fetchFn));
		const result = await list.saveUrl({
			url: "https://example.com/article",
			title: "Captured Article",
			rawHtml: "<html>captured</html>",
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue/save-html");
		expect(calls).not.toContain("POST http://localhost:3000/queue");
	});

	it("falls back to save-article when rawHtml is provided but save-html is not advertised", async () => {
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
			rawHtml: "<html>captured</html>",
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue");
		expect(calls).not.toContain("POST http://localhost:3000/queue/save-html");
	});

	it("uses save-article when rawHtml is missing even if save-html is advertised", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
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
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue");
		expect(calls).not.toContain("POST http://localhost:3000/queue/save-html");
	});
});

describe("groupOf", () => {
	it("should merge multiple understanding maps", () => {
		const combined = groupOf(
			initSaveArticleUnderstanding(),
			initDeleteArticleUnderstanding(),
		);
		expect(combined.has("save-article")).toBe(true);
		expect(combined.has("delete")).toBe(true);
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
								name: "delete",
								href: "/queue/article-1/delete",
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

	it("throws when server response entity properties are missing required fields", async () => {
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
		await expect(start()).rejects.toThrow();
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
		};
	}

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
									name: "delete",
									href: "/queue/article-1/delete",
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

		it("should include readUrl when server returns a read link", async () => {
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
									name: "delete",
									href: "/queue/article-1/delete",
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
			expect(item.readUrl).toBe(
				"http://localhost:3000/queue/article-1/view",
			);
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
			assert.equal(
				(result as Extract<typeof result, { ok: false }>).reason,
				"not-saveable",
			);
			const items = (
				result as Extract<typeof result, { reason: "not-saveable" }>
			).items;
			expect(items).toHaveLength(1);
			expect(items[0].url).toBe("https://example.com/existing");
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

		it("should track delete action from save response for later removal", async () => {
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
									name: "delete",
									href: "/queue/article-1/delete",
									method: "POST",
								},
							],
						}),
					},
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.saveUrl({ url: "https://example.com/a", title: "A" });
			const result = await list.removeUrl(
				"article-1" as ReadingListItemId,
			);
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
									name: "delete",
									href: "/queue/article-1/delete",
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

	describe("removeUrl", () => {
		it("should return fresh items from server after delete", async () => {
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 200,
						body: collectionResponse([remaining]),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await list.getAllItems();
			const result = await list.removeUrl(
				"article-1" as ReadingListItemId,
			);
			assert.equal(result.ok, true);
			const items = (result as Extract<typeof result, { ok: true }>).items;
			expect(items).toHaveLength(1);
			expect(items[0].url).toBe("https://example.com/b");
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/delete",
			);
		});

		it("should fall back to fetching collection when delete action not tracked", async () => {
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 200,
						body: collectionResponse(),
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.removeUrl(
				"article-1" as ReadingListItemId,
			);
			assert.equal(result.ok, true);
			expect(calls).toContain(
				"POST http://localhost:3000/queue/article-1/delete",
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 404,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			const result = await list.removeUrl(
				"article-1" as ReadingListItemId,
			);
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 500,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.removeUrl("article-1" as ReadingListItemId),
			).rejects.toThrow("Delete failed: 500");
		});

		it("should propagate network errors from delete", async () => {
			const networkError = new Error("Network unreachable");
			const fetchFn: ExtensionDeps["fetchFn"] = async (input, init) => {
				const url = requestInfoToUrl(input);
				const method = init?.method ?? "GET";
				if (
					method === "POST" &&
					url === "http://localhost:3000/queue/article-1/delete"
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
					{ status: 200 },
				);
			};
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.removeUrl("article-1" as ReadingListItemId),
			).rejects.toThrow("Network unreachable");
		});

		it("should throw when entity has no delete action", async () => {
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
			await expect(
				list.removeUrl("article-1" as ReadingListItemId),
			).rejects.toThrow("No delete action found for item article-1");
		});

		it("should throw when fallback collection fetch fails", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.removeUrl("article-1" as ReadingListItemId),
			).rejects.toThrow("Navigation failed: 500");
		});

		it("should throw when fallback collection has no matching entity", async () => {
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
			await expect(
				list.removeUrl("article-1" as ReadingListItemId),
			).rejects.toThrow("No delete action found for item article-1");
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

	describe("getAllItems", () => {
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
			const items = await list.getAllItems();
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
			expect(await list.getAllItems()).toEqual([]);
		});

		it("should throw when server returns an error", async () => {
			const { fetchFn } = createRoutingFetch(
				withEntryPoint({
					"GET http://localhost:3000/queue": { status: 500 },
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(list.getAllItems()).rejects.toThrow(
				"Navigation failed: 500",
			);
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
			await list.getAllItems();
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
			};
			const list = initSirenReadingList(deps);
			await expect(list.getAllItems()).rejects.toThrow(
				"No access token available",
			);
		});
	});
});
