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
