import assert from "node:assert/strict";
import { noopLogger } from "@packages/logger";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { initExtension, type ExtensionDeps } from "./siren-walker";
import {
	groupOf,
	initSaveArticleUnderstanding,
	initSaveContentUnderstanding,
	initListArticlesUnderstanding,
	initSaveArticlesUnderstanding,
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
			queued: 0,
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
