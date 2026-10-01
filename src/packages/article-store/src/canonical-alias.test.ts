import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initCanonicalAliasStore, initResolveCanonicalIdentity } from "./canonical-alias";

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeClient(impl: (input: unknown) => unknown): DynamoDBDocumentClient {
	const send = async (input: unknown) => impl(input);
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const CapturedCommand = z.object({
	input: z.object({
		Key: z.record(z.string(), z.unknown()).optional(),
		UpdateExpression: z.string().optional(),
		ConditionExpression: z.string().optional(),
		ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
	}),
});

const TABLE = "test-articles";
const NOW = new Date("2026-07-15T10:00:00.000Z");

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "The conditional request failed" });
}

describe("initCanonicalAliasStore", () => {
	describe("claimAlias", () => {
		it("writes id(terminal) → target as a first-writer-wins upsert and returns 'claimed'", async () => {
			let captured: unknown;
			const client = createFakeClient((input) => {
				captured = input;
				return {};
			});
			const { claimAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			const outcome = await claimAlias({
				aliasUrl: "https://site.com/page",
				targetOriginalUrl: "https://site.com/page.html",
				now: NOW,
			});

			expect(outcome).toBe("claimed");
			const { input } = CapturedCommand.parse(captured);
			expect(input.Key).toEqual({ url: "site.com/page" });
			expect(input.ConditionExpression).toBe("attribute_not_exists(#url)");
			expect(input.ExpressionAttributeValues).toEqual({
				":alias": "alias",
				":target": "https://site.com/page.html",
				":now": "2026-07-15T10:00:00.000Z",
			});
		});

		it("returns 'occupied' when the identity is already taken (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { claimAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			const outcome = await claimAlias({
				aliasUrl: "https://site.com/page",
				targetOriginalUrl: "https://site.com/page.html",
				now: NOW,
			});

			expect(outcome).toBe("occupied");
		});

		it("propagates non-conditional write errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("DDB unavailable");
			});
			const { claimAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				claimAlias({ aliasUrl: "https://site.com/page", targetOriginalUrl: "https://site.com/page.html", now: NOW }),
			).rejects.toThrow("DDB unavailable");
		});
	});

	describe("setDisplayUrl", () => {
		it("stamps the destination on the origin article, gated on it being a real row", async () => {
			let captured: unknown;
			const client = createFakeClient((input) => {
				captured = input;
				return {};
			});
			const { setDisplayUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			await setDisplayUrl({
				articleUrl: "https://site.com/page.html",
				displayUrl: "https://site.com/page",
			});

			const { input } = CapturedCommand.parse(captured);
			expect(input.Key).toEqual({ url: "site.com/page.html" });
			expect(input.UpdateExpression).toBe("SET displayUrl = :displayUrl");
			expect(input.ConditionExpression).toBe("attribute_exists(routeId)");
			expect(input.ExpressionAttributeValues).toEqual({ ":displayUrl": "https://site.com/page" });
		});

		it("is a no-op when the target is not a real article (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { setDisplayUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				setDisplayUrl({ articleUrl: "https://site.com/page.html", displayUrl: "https://site.com/page" }),
			).resolves.toBeUndefined();
		});

		it("propagates non-conditional write errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("DDB unavailable");
			});
			const { setDisplayUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				setDisplayUrl({ articleUrl: "https://site.com/page.html", displayUrl: "https://site.com/page" }),
			).rejects.toThrow("DDB unavailable");
		});
	});

	describe("reconcileStubMetadata", () => {
		it("re-points the stub title, site name and excerpt at the destination host", async () => {
			let captured: unknown;
			const client = createFakeClient((input) => {
				captured = input;
				return {};
			});
			const { reconcileStubMetadata } = initCanonicalAliasStore({ client, tableName: TABLE });

			await reconcileStubMetadata({
				articleUrl: "https://wrapper.example/link/188518",
				displayUrl: "https://dest.example/article?utm_source=newsletter",
			});

			const { input } = CapturedCommand.parse(captured);
			expect(input.Key).toEqual({ url: "wrapper.example/link/188518" });
			expect(input.UpdateExpression).toBe("SET title = :title, siteName = :siteName, excerpt = :excerpt");
			expect(input.ConditionExpression).toBe("attribute_exists(routeId) AND title = :originStubTitle");
			expect(input.ExpressionAttributeValues).toEqual({
				":title": "Article from dest.example",
				":siteName": "dest.example",
				":excerpt": "Saved from dest.example.",
				":originStubTitle": "Article from wrapper.example",
			});
		});

		it("is a no-op when the row already holds real crawled metadata (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { reconcileStubMetadata } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				reconcileStubMetadata({
					articleUrl: "https://wrapper.example/link/188518",
					displayUrl: "https://dest.example/article",
				}),
			).resolves.toBeUndefined();
		});

		it("propagates non-conditional write errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("DDB unavailable");
			});
			const { reconcileStubMetadata } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				reconcileStubMetadata({
					articleUrl: "https://wrapper.example/link/188518",
					displayUrl: "https://dest.example/article",
				}),
			).rejects.toThrow("DDB unavailable");
		});
	});

	describe("pinContentSource", () => {
		it("stamps the snapshot the content is read from onto the article, gated on it being a real row", async () => {
			let captured: unknown;
			const client = createFakeClient((input) => {
				captured = input;
				return {};
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await pinContentSource({
				articleUrl: "http://dead.example/article",
				contentSourceUrl: "https://web.archive.org/web/20140413140620/http://dead.example/article",
			});

			const { input } = CapturedCommand.parse(captured);
			expect(input.Key).toEqual({ url: "dead.example/article" });
			expect(input.UpdateExpression).toBe("SET contentSourceUrl = :contentSourceUrl");
			expect(input.ConditionExpression).toBe("attribute_exists(routeId)");
			expect(input.ExpressionAttributeValues).toEqual({
				":contentSourceUrl": "https://web.archive.org/web/20140413140620/http://dead.example/article",
			});
		});

		it("is a no-op when the target is not a real article (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				pinContentSource({ articleUrl: "http://dead.example/article", contentSourceUrl: "https://archive.example/x" }),
			).resolves.toBeUndefined();
		});

		it("propagates non-conditional write errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("DDB unavailable");
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				pinContentSource({ articleUrl: "http://dead.example/article", contentSourceUrl: "https://archive.example/x" }),
			).rejects.toThrow("DDB unavailable");
		});
	});

	describe("findAdoptedFetchUrl", () => {
		it("returns the pinned destination for an adopted article", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "evil.com/x", routeId: "a".repeat(32), originalUrl: "https://evil.com/x", displayUrl: "https://victim.com/article" },
			}));
			const { findAdoptedFetchUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findAdoptedFetchUrl("https://evil.com/x")).toBe("https://victim.com/article");
		});

		it("prefers the pinned content source over the adopted destination", async () => {
			const client = createFakeClient(() => ({
				Item: {
					url: "dead.example/article",
					routeId: "a".repeat(32),
					originalUrl: "http://dead.example/article",
					displayUrl: "https://dead.example/article",
					contentSourceUrl: "https://web.archive.org/web/20140413140620/http://dead.example/article",
				},
			}));
			const { findAdoptedFetchUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findAdoptedFetchUrl("http://dead.example/article")).toBe(
				"https://web.archive.org/web/20140413140620/http://dead.example/article",
			);
		});

		it("returns undefined for a normal (un-adopted) article", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", routeId: "a".repeat(32), originalUrl: "https://site.com/page" },
			}));
			const { findAdoptedFetchUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findAdoptedFetchUrl("https://site.com/page")).toBeUndefined();
		});

		it("returns undefined for a missing row", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const { findAdoptedFetchUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findAdoptedFetchUrl("https://site.com/page")).toBeUndefined();
		});
	});

	describe("findIdentityRow", () => {
		it("reports an alias row with its target", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", rowKind: "alias", aliasTargetUrl: "https://site.com/page.html" },
			}));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findIdentityRow("https://site.com/page")).toEqual({
				kind: "alias",
				targetUrl: "https://site.com/page.html",
			});
		});

		it("reports a real article row", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", routeId: "a".repeat(32), originalUrl: "https://site.com/page", title: "Real" },
			}));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findIdentityRow("https://site.com/page")).toEqual({ kind: "article" });
		});

		it("reports an absent identity", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findIdentityRow("https://site.com/page")).toEqual({ kind: "absent" });
		});

		it("fails loudly on an alias marker that lost its target", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", rowKind: "alias" },
			}));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(findIdentityRow("https://site.com/page")).rejects.toThrow("has no aliasTargetUrl");
		});
	});

	describe("resolveAlias", () => {
		it("returns the target URL for an alias row", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", rowKind: "alias", aliasTargetUrl: "https://site.com/page.html" },
			}));
			const { resolveAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await resolveAlias("https://site.com/page")).toBe("https://site.com/page.html");
		});

		it("returns undefined when no row exists at the identity", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const { resolveAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await resolveAlias("https://site.com/page")).toBeUndefined();
		});

		it("returns undefined for a real article row (no alias marker)", async () => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", routeId: "a".repeat(32), originalUrl: "https://site.com/page", title: "Real" },
			}));
			const { resolveAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await resolveAlias("https://site.com/page")).toBeUndefined();
		});
	});
});

describe("initResolveCanonicalIdentity", () => {
	it("returns the alias target when the url is an adopted terminal", async () => {
		const resolve = initResolveCanonicalIdentity({ resolveAlias: async () => "https://site.com/page.html" });

		expect(await resolve("https://site.com/page")).toBe("https://site.com/page.html");
	});

	it("returns the url unchanged when it is not an alias", async () => {
		const resolve = initResolveCanonicalIdentity({ resolveAlias: async () => undefined });

		expect(await resolve("https://site.com/page")).toBe("https://site.com/page");
	});
});
