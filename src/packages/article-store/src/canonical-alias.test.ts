import { ConditionalCheckFailedException, TransactionCanceledException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initCanonicalAliasStore } from "./canonical-alias";

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
		ConsistentRead: z.boolean().optional(),
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
		it("writes id(terminal) → target as a first-writer-wins upsert", async () => {
			let captured: unknown;
			const client = createFakeClient((input) => {
				captured = input;
				return {};
			});
			const { claimAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			await claimAlias({
				aliasUrl: "https://site.com/page",
				targetOriginalUrl: "https://site.com/page.html",
				now: NOW,
			});

			const { input } = CapturedCommand.parse(captured);
			expect(input.Key).toEqual({ url: "site.com/page" });
			expect(input.ConditionExpression).toBe("attribute_not_exists(#url)");
			expect(input.ExpressionAttributeValues).toEqual({
				":alias": "alias",
				":target": "https://site.com/page.html",
				":now": "2026-07-15T10:00:00.000Z",
			});
		});

		it("leaves an already-taken identity alone without failing (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { claimAlias } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				claimAlias({
					aliasUrl: "https://site.com/page",
					targetOriginalUrl: "https://site.com/page.html",
					now: NOW,
				}),
			).resolves.toBeUndefined();
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
		it("marks direct content that predates the pin when the row was never pinned or selected", async () => {
			const captured: unknown[] = [];
			const client = createFakeClient((input) => {
				captured.push(input);
				return {};
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await pinContentSource({
				articleUrl: "http://dead.example/article",
				contentSourceUrl: "https://web.archive.org/web/20140413140620/http://dead.example/article",
				sourceOriginalUrl: "http://dead.example/article",
			});

			expect(captured).toHaveLength(1);
			const { input } = CapturedCommand.parse(captured[0]);
			expect(input.Key).toEqual({ url: "dead.example/article" });
			expect(input.UpdateExpression).toBe("SET contentSourceUrl = :contentSourceUrl, sourceOriginalUrl = :sourceOriginalUrl, directContentBeforePin = :true");
			expect(input.ConditionExpression).toBe("attribute_exists(routeId) AND (displayUrl = :sourceOriginalUrl OR (attribute_not_exists(displayUrl) AND originalUrl = :sourceOriginalUrl)) AND attribute_not_exists(contentSourceUrl) AND attribute_not_exists(canonicalCandidateId) AND (contentSourceTier IN (:tier0, :tier1) OR (attribute_not_exists(contentSourceTier) AND wordCount > :zero))");
			expect(input.ExpressionAttributeValues).toEqual({
				":sourceOriginalUrl": "http://dead.example/article",
				":contentSourceUrl": "https://web.archive.org/web/20140413140620/http://dead.example/article",
				":true": true,
				":tier0": "tier-0",
				":tier1": "tier-1",
				":zero": 0,
			});
		});

		it("pins without the marker when the row already carried a pin or holds no direct content", async () => {
			const captured: unknown[] = [];
			const client = createFakeClient((input) => {
				captured.push(input);
				if (captured.length === 1) throw conditionalCheckFailed();
				return {};
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await pinContentSource({
				articleUrl: "http://dead.example/article",
				contentSourceUrl: "https://web.archive.org/web/20140413140620/http://dead.example/article",
				sourceOriginalUrl: "http://dead.example/article",
			});

			expect(captured).toHaveLength(2);
			const { input } = CapturedCommand.parse(captured[1]);
			expect(input.Key).toEqual({ url: "dead.example/article" });
			expect(input.UpdateExpression).toBe("SET contentSourceUrl = :contentSourceUrl, sourceOriginalUrl = :sourceOriginalUrl");
			expect(input.ConditionExpression).toBe("attribute_exists(routeId) AND (displayUrl = :sourceOriginalUrl OR (attribute_not_exists(displayUrl) AND originalUrl = :sourceOriginalUrl))");
			expect(input.ExpressionAttributeValues).toEqual({
				":sourceOriginalUrl": "http://dead.example/article",
				":contentSourceUrl": "https://web.archive.org/web/20140413140620/http://dead.example/article",
			});
		});

		it("is a no-op when the target is not a real article (conditional check fails)", async () => {
			const client = createFakeClient(() => {
				throw conditionalCheckFailed();
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				pinContentSource({ articleUrl: "http://dead.example/article", contentSourceUrl: "https://archive.example/x", sourceOriginalUrl: "http://dead.example/article" }),
			).rejects.toThrow("conditional request failed");
		});

		it("propagates non-conditional write errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("DDB unavailable");
			});
			const { pinContentSource } = initCanonicalAliasStore({ client, tableName: TABLE });

			await expect(
				pinContentSource({ articleUrl: "http://dead.example/article", contentSourceUrl: "https://archive.example/x", sourceOriginalUrl: "http://dead.example/article" }),
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

		it("fetches the adopted destination even when an archive capture is recorded for the article", async () => {
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

			expect(await findAdoptedFetchUrl("http://dead.example/article")).toBe("https://dead.example/article");
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

	describe("findContentSourceUrl", () => {
		it("returns the archive capture recorded for the article", async () => {
			const client = createFakeClient(() => ({
				Item: {
					url: "dead.example/article",
					routeId: "a".repeat(32),
					originalUrl: "http://dead.example/article",
					contentSourceUrl: "https://web.archive.org/web/20140413140620/http://dead.example/article",
				},
			}));
			const { findContentSourceUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findContentSourceUrl("http://dead.example/article")).toBe(
				"https://web.archive.org/web/20140413140620/http://dead.example/article",
			);
		});

		it.each([
			{ label: "an article without a capture", item: { url: "site.com/page", routeId: "a".repeat(32), originalUrl: "https://site.com/page" } },
			{ label: "a missing row", item: undefined },
		])("returns undefined for $label", async ({ item }) => {
			const client = createFakeClient(() => ({ Item: item }));
			const { findContentSourceUrl } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findContentSourceUrl("https://site.com/page")).toBeUndefined();
		});
	});

	describe("findIdentityRow", () => {
		it("reads the current identity pin rather than a stale pre-adoption destination", async () => {
			const client = createFakeClient((command) => ({ Item: { originalUrl: "https://origin.example/post", displayUrl: CapturedCommand.parse(command).input.ConsistentRead === true ? "https://current.example/post" : "https://old.example/post" } }));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });
			expect(await findIdentityRow("https://origin.example/post")).toEqual({ kind: "article", originalUrl: "https://current.example/post" });
		});
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

			expect(await findIdentityRow("https://site.com/page")).toEqual({ kind: "article", originalUrl: "https://site.com/page" });
		});

		it.each([
			{ stored: { originalUrl: "http://site.com/page" }, originalUrl: undefined },
			{ stored: { originalUrl: "http://site.com/page", displayUrl: "https://site.com/destination" }, originalUrl: "https://site.com/destination" },
		])("reports only the identity a re-save keeps for a purged article row %j", async ({ stored, originalUrl }) => {
			const client = createFakeClient(() => ({
				Item: { url: "site.com/page", routeId: "a".repeat(32), purgedAt: "2026-07-16T10:00:00.000Z", ...stored },
			}));
			const { findIdentityRow } = initCanonicalAliasStore({ client, tableName: TABLE });

			expect(await findIdentityRow("https://site.com/page")).toEqual({ kind: "article", originalUrl });
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


describe("atomic identity updates", () => {
	it("claims the destination and pins its owner in the same transaction", async () => {
		const commands: unknown[] = [];
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => { commands.push(command); return {}; }) });
		expect(await store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).toBe("adopted");
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ input: { TransactItems: [
			{ Update: { Key: { url: "b.example/b" }, ConditionExpression: "attribute_not_exists(#url) OR (rowKind = :alias AND aliasTargetUrl = :target)" } },
			{ Update: { Key: { url: "a.example/a" }, ConditionExpression: "attribute_exists(routeId) AND (attribute_not_exists(sourceOriginalUrl) OR sourceOriginalUrl = :destination) AND (attribute_not_exists(displayUrl) OR displayUrl = :destination) AND (attribute_not_exists(contentSourceTier) OR contentSourceTier <> :firstPartyTier) AND (attribute_not_exists(canonicalOriginalUrl) OR canonicalOriginalUrl = :destination)" } },
		] } });
	});
	it.each([undefined, [{ Code: "TransactionConflict" }], [{ Code: "None" }, { Code: "TransactionConflict" }]])("rethrows a transaction cancelled without a failed condition %j", async (CancellationReasons) => {
		const failure = new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons });
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => { throw failure; }) });
		await expect(store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).rejects.toBe(failure);
	});
	it.each([[[{ Code: "None" }, { Code: "ConditionalCheckFailed" }]], [[{ Code: "ConditionalCheckFailed" }, { Code: "ConditionalCheckFailed" }]]])("declines without a second write when the article refuses the destination %j", async (CancellationReasons) => {
		const commands: unknown[] = [];
		const failure = new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons });
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => { commands.push(command); throw failure; }) });
		expect(await store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).toBe("declined");
		expect(commands).toHaveLength(1);
	});
	it("still records the display URL when only the destination key is already occupied (fan-in origin)", async () => {
		const commands: unknown[] = [];
		const occupied = new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] });
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => {
			commands.push(command);
			if (commands.length === 1) throw occupied;
			return {};
		}) });
		expect(await store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).toBe("adopted");
		expect(commands).toHaveLength(2);
		expect(commands[1]).toMatchObject({ input: {
			Key: { url: "a.example/a" },
			UpdateExpression: "SET displayUrl = :destination",
			ConditionExpression: "attribute_exists(routeId) AND (attribute_not_exists(sourceOriginalUrl) OR sourceOriginalUrl = :destination) AND (attribute_not_exists(displayUrl) OR displayUrl = :destination) AND (attribute_not_exists(contentSourceTier) OR contentSourceTier <> :firstPartyTier) AND (attribute_not_exists(canonicalOriginalUrl) OR canonicalOriginalUrl = :destination)",
			ExpressionAttributeValues: { ":destination": "https://b.example/b", ":firstPartyTier": "tier-0" },
		} });
	});
	it.each([["declines", conditionalCheckFailed(), "declined"], ["propagates", new Error("offline"), "offline"]] as const)("%s when the fan-in display URL write fails", async (_label, failure, expected) => {
		const occupied = new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] });
		let calls = 0;
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => { calls += 1; throw calls === 1 ? occupied : failure; }) });
		const call = store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW });
		if (expected === "declined") await expect(call).resolves.toBe("declined");
		else await expect(call).rejects.toThrow(expected);
	});
	it("declines without writing an alias when the reader's own capture already serves the article", async () => {
		const row = { url: "a.example/a", routeId: "r".repeat(32), originalUrl: "https://a.example/a", contentSourceTier: "tier-0" };
		const writes: unknown[] = [];
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => {
			const articleLeg = z.object({ input: z.object({ TransactItems: z.tuple([z.unknown(), z.object({ Update: z.object({ ConditionExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }) })]) }) }).parse(command).input.TransactItems[1].Update;
			const refusesFirstPartyContent = articleLeg.ConditionExpression.includes("contentSourceTier <> :firstPartyTier") && articleLeg.ExpressionAttributeValues[":firstPartyTier"] === row.contentSourceTier;
			if (refusesFirstPartyContent) throw new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }] });
			writes.push(command);
			return {};
		}) });
		expect(await store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://login.example/wall", now: NOW })).toBe("declined");
		expect(writes).toEqual([]);
	});
	it("declines a later redirect once a candidate is committed against the original URL", async () => {
		const row = { url: "a.example/a", routeId: "r".repeat(32), originalUrl: "https://a.example/a", contentSourceTier: "tier-1", canonicalCandidateId: "candidate", canonicalOriginalUrl: "https://a.example/a" };
		const writes: unknown[] = [];
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => {
			const articleLeg = z.object({ input: z.object({ TransactItems: z.tuple([z.unknown(), z.object({ Update: z.object({ ConditionExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }) })]) }) }).parse(command).input.TransactItems[1].Update;
			const keepsCommittedOriginal = articleLeg.ConditionExpression.includes("canonicalOriginalUrl = :destination") && articleLeg.ExpressionAttributeValues[":destination"] !== row.canonicalOriginalUrl;
			if (keepsCommittedOriginal) throw new TransactionCanceledException({ $metadata: {}, message: "transaction refused", CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }] });
			writes.push(command);
			return {};
		}) });
		expect(await store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).toBe("declined");
		expect(writes).toEqual([]);
	});
	it("propagates ordinary transaction errors", async () => {
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => { throw new Error("offline"); }) });
		await expect(store.adoptDestination({ articleUrl: "https://a.example/a", destinationUrl: "https://b.example/b", now: NOW })).rejects.toThrow("offline");
	});
	it.each([undefined, "https://archive.ph/abc"])("repairs one legacy row without claiming its original %s", async (contentSourceUrl) => {
		const commands: unknown[] = [];
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => { commands.push(command); return {}; }) });
		expect(await store.repairWrapperIdentity({ articleUrl: "https://archive.ph/abc", expectedOriginalUrl: "https://archive.ph/abc", originalUrl: "https://site.com/page", contentSourceUrl })).toBe(true);
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ input: {
			Key: { url: "archive.ph/abc" },
			UpdateExpression: contentSourceUrl === undefined ? "SET displayUrl = :original REMOVE contentSourceUrl, sourceOriginalUrl" : "SET displayUrl = :original, contentSourceUrl = :source, sourceOriginalUrl = :original",
			ConditionExpression: "attribute_exists(routeId) AND (displayUrl = :expected OR (attribute_not_exists(displayUrl) AND originalUrl = :expected)) AND (attribute_not_exists(sourceOriginalUrl) OR sourceOriginalUrl = :original)",
		} });
	});
	it("refuses a legacy repair whose effective identity changed", async () => {
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => { throw conditionalCheckFailed(); }) });
		await expect(store.repairWrapperIdentity({ articleUrl: "https://archive.ph/abc", expectedOriginalUrl: "https://archive.ph/abc", originalUrl: "https://site.com/page" })).resolves.toBe(false);
	});
	it("propagates legacy repair write failures", async () => {
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => { throw new Error("offline"); }) });
		await expect(store.repairWrapperIdentity({ articleUrl: "https://archive.ph/abc", expectedOriginalUrl: "https://archive.ph/abc", originalUrl: "https://site.com/page" })).rejects.toThrow("offline");
	});
	it("persists a verified alias mapping and reads the proof as a pair", async () => {
		const binding = { contentSourceUrl: "https://archive.ph/abc", sourceOriginalUrl: "https://site.com/page" };
		const commands: unknown[] = [];
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient((command) => {
			commands.push(command); return { Item: { rowKind: "alias", aliasTargetUrl: "https://site.com/page", ...binding } };
		}) });
		await store.claimAlias({ aliasUrl: "https://archive.ph/abc", targetOriginalUrl: "https://site.com/page", sourceBinding: binding, now: NOW });
		expect(commands[0]).toMatchObject({ input: { ExpressionAttributeValues: { ":source": binding.contentSourceUrl, ":original": binding.sourceOriginalUrl } } });
		expect(await store.findIdentityRow("https://archive.ph/abc")).toEqual({ kind: "alias", targetUrl: binding.sourceOriginalUrl, sourceBinding: binding });
	});
	it.each([
		{ displayUrl: "https://site.com/destination", contentSourceUrl: "https://archive.ph/abc", sourceOriginalUrl: "https://site.com/destination" },
		{ contentSourceUrl: "https://archive.ph/abc" },
		{},
	])("returns the effective article identity and only complete source pairs %j", async (fields) => {
		const store = initCanonicalAliasStore({ tableName: TABLE, client: createFakeClient(() => ({ Item: { ...fields } })) });
		const result = await store.findIdentityRow("https://site.com/page");
		expect(result).toEqual({ kind: "article", originalUrl: fields.displayUrl, sourceBinding: fields.sourceOriginalUrl === undefined ? undefined : { contentSourceUrl: fields.contentSourceUrl, sourceOriginalUrl: fields.sourceOriginalUrl } });
	});
});
