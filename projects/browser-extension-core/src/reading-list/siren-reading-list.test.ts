import assert from "node:assert/strict";
import { noopLogger } from "@packages/hutch-logger";
import type { ReadingListItemId } from "../domain/reading-list-item.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import {
	initSirenReadingList,
	initExtension,
	initSaveArticleUnderstanding,
	initSaveArticlesUnderstanding,
	initSaveHtmlUnderstanding,
	initSaveContentUnderstanding,
	initDeleteArticleUnderstanding,
	initListArticlesUnderstanding,
	groupOf,
	httpCacheable,
	type ExtensionDeps,
	type SirenReadingListDeps,
} from "./siren-reading-list";
import { pdfContentBody, htmlContentBody } from "./content-body-parsers";

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
			expect(result.items[0].boundActions.delete).toBeDefined();
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
			expect(result.items[0].boundActions.delete).toBeDefined();
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
			const result = await collection.items[0].boundActions.delete();
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
			const result = await collection.items[0].boundActions.delete();
			expect(result.items).toHaveLength(1);
			expect(result.items[0].url).toBe("https://example.com/b");
			expect(result.items[0].boundActions.delete).toBeDefined();
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
				collection.items[0].boundActions.delete(),
			).rejects.toThrow("delete target not found");
		});

		it("sends Prefer: return=representation on delete (RFC 7240)", async () => {
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
			await collection.items[0].boundActions.delete();
			expect(observedPrefer).toBe("return=representation");
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
			expect(result.items[0].boundActions.delete).toBeDefined();
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
			initSaveHtmlUnderstanding({ logger: noopLogger }),
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

	it("surfaces the server's messages and attempts no fallback save", async () => {
		const { fetchFn, calls } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionWithSaveHtmlResponse(),
				},
				"POST http://localhost:3000/queue/save-html": {
					status: 403,
					body: messageRefusalBody(),
				},
			}),
		);
		const start = initExtension(createUnderstandingsWithSaveHtml(), createDeps(fetchFn));
		const collection = await start();
		await expect(
			collection.actions["save-html"]({ url: "https://example.com/article", rawHtml: "<html>x</html>" }),
		).rejects.toThrow("Save blocked");
		// The refusal carries no action, so no second (fallback) save fires.
		expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
			"POST http://localhost:3000/queue/save-html",
		]);
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
					name: "delete",
					href: "/queue/article-1/delete",
					method: "POST",
				},
			],
		});
	}

	function createUnderstandingsWithSaveContent() {
		return groupOf(
			initSaveArticleUnderstanding(),
			initSaveContentUnderstanding({ parsers: { "application/pdf": pdfContentBody, "text/html": htmlContentBody }, logger: noopLogger }),
			initDeleteArticleUnderstanding(),
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
			initDeleteArticleUnderstanding(),
			httpCacheable(initListArticlesUnderstanding()),
		);
	}

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
			logger: noopLogger,
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

	it("prefers save-html when content is text/html AND the server advertises save-html", async () => {
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
			content: { bytes: new TextEncoder().encode("<html>captured</html>").buffer, mediaType: "text/html" },
		});
		assert.equal(result.ok, true);
		expect(calls).toContain("POST http://localhost:3000/queue/save-html");
		expect(calls).not.toContain("POST http://localhost:3000/queue");
	});

	it("falls back to save-article when content is text/html but save-html is not advertised", async () => {
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
		expect(calls).not.toContain("POST http://localhost:3000/queue/save-html");
	});

	it("uses save-article when content is missing even if save-html is advertised", async () => {
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
			COLLECTION_ACTIONS_WITH_SAVE_HTML[1],
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
		expect(calls).not.toContain("POST http://localhost:3000/queue/save-html");
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
			logger: noopLogger,
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
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "delete",
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

	describe("invokeAction delete path", () => {
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
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "delete",
			});
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
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "delete",
			});
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
			const result = await list.invokeAction({
				id: "article-1" as ReadingListItemId,
				name: "delete",
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
					"POST http://localhost:3000/queue/article-1/delete": {
						status: 500,
					},
				}),
			);
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "delete" }),
			).rejects.toThrow("delete failed: 500");
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
					{
						status: 200,
						headers: { "Content-Type": "application/vnd.siren+json" },
					},
				);
			};
			const list = initSirenReadingList(createAdapterDeps(fetchFn));
			await expect(
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "delete" }),
			).rejects.toThrow("Network unreachable");
		});

		it("returns not-found when the entity advertises no delete action", async () => {
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
			const result = await list.invokeAction({ id: "article-1" as ReadingListItemId, name: "delete" });
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
				list.invokeAction({ id: "article-1" as ReadingListItemId, name: "delete" }),
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
			const result = await list.invokeAction({ id: "article-1" as ReadingListItemId, name: "delete" });
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
			await list.getAllItems();
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
			await list.getAllItems();
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
				logger: noopLogger,
			};
			const list = initSirenReadingList(deps);
			await expect(list.getAllItems()).rejects.toThrow(
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
									name: "delete",
									title: "Remove from list",
									href: "/queue/1/delete",
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
			{ name: "delete", title: "Remove from list" },
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
								{ name: "delete", href: "/queue/1/delete", method: "POST" },
							],
						}),
					]),
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items[0].actions.map((a) => a.name)).toEqual(["delete"]);
	});

	it("follows the collection's next link so items past the first page are reachable", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue" },
				{ rel: ["next"], href: "/queue?page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const page2 = JSON.stringify({
			class: ["collection", "articles"],
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
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
			"GET http://localhost:3000/queue?page=2": { status: 200, body: page2 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items.map((i) => i.id)).toEqual(["1", "2"]);
	});

	it("stops following navigation pages when a next page errors", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue" },
				{ rel: ["next"], href: "/queue?page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
			"GET http://localhost:3000/queue?page=2": { status: 500 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items.map((i) => i.id)).toEqual(["1"]);
	});

	it("ignores a navigation next link whose scheme is unactionable", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue" },
				{ rel: ["next"], href: "mailto:more@example.com" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items.map((i) => i.id)).toEqual(["1"]);
	});

	it("aggregates every search page by following the search response's next link", async () => {
		const searchPage1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue?status=unread" },
				{ rel: ["next"], href: "/queue?status=unread&page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const searchPage2 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "2",
					url: "https://example.com/b",
					title: "B",
					savedAt: "2026-01-15T11:00:00.000Z",
				}),
			],
			links: [{ rel: ["self"], href: "/queue?status=unread&page=2" }],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"GET http://localhost:3000/queue?status=unread": {
					status: 200,
					body: searchPage1,
				},
				"GET http://localhost:3000/queue?status=unread&page=2": {
					status: 200,
					body: searchPage2,
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions.search({ status: "unread" });
		expect(result.items.map((i) => i.id)).toEqual(["1", "2"]);
	});

	it("stops following search pages when a later page errors, returning what it has", async () => {
		const searchPage1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue?status=unread" },
				{ rel: ["next"], href: "/queue?status=unread&page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"GET http://localhost:3000/queue?status=unread": {
					status: 200,
					body: searchPage1,
				},
				"GET http://localhost:3000/queue?status=unread&page=2": { status: 500 },
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions.search({ status: "unread" });
		expect(result.items.map((i) => i.id)).toEqual(["1"]);
	});

	it("stops navigation when the next link points back to a page already visited", async () => {
		const page = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue" },
				{ rel: ["next"], href: "/queue" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page },
			"GET http://localhost:3000/queue": { status: 200, body: page },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items.map((i) => i.id)).toEqual(["1"]);
	});

	it("stops navigation when the next links form a repeating cycle", async () => {
		const page1 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue" },
				{ rel: ["next"], href: "/queue?page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const page2 = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "2",
					url: "https://example.com/b",
					title: "B",
					savedAt: "2026-01-15T11:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue?page=2" },
				{ rel: ["next"], href: "/queue?page=2" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch({
			"GET http://localhost:3000/": { status: 200, body: page1 },
			"GET http://localhost:3000/queue": { status: 200, body: page1 },
			"GET http://localhost:3000/queue?page=2": { status: 200, body: page2 },
		});
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const result = await start();
		expect(result.items.map((i) => i.id)).toEqual(["1", "2"]);
	});

	it("stops a search whose next link points back to a page already fetched", async () => {
		const searchPage = JSON.stringify({
			class: ["collection", "articles"],
			entities: [
				articleEntity({
					id: "1",
					url: "https://example.com/a",
					title: "A",
					savedAt: "2026-01-15T10:00:00.000Z",
				}),
			],
			links: [
				{ rel: ["self"], href: "/queue?status=unread" },
				{ rel: ["next"], href: "/queue?status=unread" },
			],
			actions: COLLECTION_ACTIONS,
		});
		const { fetchFn } = createRoutingFetch(
			withEntryPoint({
				"GET http://localhost:3000/queue": {
					status: 200,
					body: collectionResponse(),
				},
				"GET http://localhost:3000/queue?status=unread": {
					status: 200,
					body: searchPage,
				},
			}),
		);
		const start = initExtension(createUnderstandings(), createDeps(fetchFn));
		const collection = await start();
		const result = await collection.actions.search({ status: "unread" });
		expect(result.items.map((i) => i.id)).toEqual(["1"]);
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
