import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CandidateIdSchema } from "@packages/article-state-types";
import { type HighlightId, HighlightIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { HighlightAnchor } from "@packages/provider-contracts/highlights";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbHighlightAnchors } from "./dynamodb-highlight-anchors";
import { HIGHLIGHT_KEY_PREFIX } from "./user-readlist-partition";

type Item = Record<string, unknown>;
type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

const PAGE_SIZE = 2;
const TABLE = "user-articles";
const URL_ID = ArticleResourceUniqueId.parse("https://example.com/post").value;
const OTHER_URL_ID = ArticleResourceUniqueId.parse("https://example.com/other").value;
const USER = UserIdSchema.parse("abc123");
const OTHER_USER = UserIdSchema.parse("def456");

function rowKey(item: Item): string {
	return `${String(item.userId)}|${String(item.url)}`;
}

function idOf(n: number): HighlightId {
	return HighlightIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function aRow(params: { userId: string; highlightOf: string; highlightId: HighlightId; anchorRevision?: number }): Item {
	return {
		userId: params.userId,
		url: `${HIGHLIGHT_KEY_PREFIX}${params.highlightOf}/${params.highlightId}`,
		highlightId: params.highlightId,
		highlightOf: params.highlightOf,
		exact: "a passage",
		prefix: "before ",
		suffix: " after",
		start: 10,
		end: 19,
		anchoredContentHash: "hash-1",
		anchoredCandidateId: "candidate-1",
		anchorState: "anchored",
		orderKey: 10,
		createdAt: "2026-11-01T10:00:00.000Z",
		updatedAt: "2026-11-01T10:00:00.000Z",
		anchorRevision: params.anchorRevision ?? 0,
	};
}

function createFakeTable() {
	const items = new Map<string, Item>();
	const sent: { name: string; input: Record<string, unknown> }[] = [];

	const valuesOf = (input: Record<string, unknown>): Item => Object(input.ExpressionAttributeValues);

	const query = (input: Record<string, unknown>) => {
		assert.equal(input.IndexName, "highlightOf-index");
		const matching = [...items.values()]
			.filter((item) => item.highlightOf === valuesOf(input)[":highlightOf"])
			.sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
		const startKey = input.ExclusiveStartKey;
		const startAt =
			startKey === undefined ? 0 : matching.findIndex((item) => rowKey(item) === rowKey(Object(startKey))) + 1;
		const page = matching.slice(startAt, startAt + PAGE_SIZE);
		const last = page.at(-1);
		const more = startAt + PAGE_SIZE < matching.length;
		return {
			Items: page,
			Count: page.length,
			...(more && last ? { LastEvaluatedKey: { userId: last.userId, url: last.url } } : {}),
		};
	};

	const update = (input: Record<string, unknown>) => {
		const key = rowKey(Object(input.Key));
		const existing = items.get(key);
		const values = valuesOf(input);
		if (existing === undefined || existing.anchorRevision !== values[":expectedRevision"]) {
			throw new ConditionalCheckFailedException({
				message: "conditional",
				$metadata: {},
				...(existing === undefined ? {} : { Item: {} }),
			});
		}
		const { anchoredCandidateId: _previous, ...rest } = existing;
		const removesCandidate = String(input.UpdateExpression).includes("REMOVE anchoredCandidateId");
		const next: Item = {
			...rest,
			...(removesCandidate ? {} : { anchoredCandidateId: values[":anchoredCandidateId"] }),
			start: values[":start"],
			end: values[":end"],
			anchorState: values[":anchorState"],
			anchoredContentHash: values[":anchoredContentHash"],
			orderKey: values[":orderKey"],
			anchorRevision: Number(existing.anchorRevision) + Number(values[":one"]),
		};
		items.set(key, next);
		return {};
	};

	const send = async (command: SentCommand) => {
		sent.push({ name: command.constructor.name, input: command.input });
		if (command.constructor.name === "QueryCommand") return query(command.input);
		if (command.constructor.name === "UpdateCommand") return update(command.input);
		throw new Error(`unexpected command ${command.constructor.name}`);
	};

	return {
		client: { send } as unknown as DynamoDBDocumentClient,
		items,
		sent,
		seed: (item: Item) => items.set(rowKey(item), item),
	};
}

const MOVED: HighlightAnchor = {
	start: 40,
	end: 49,
	anchorState: "moved",
	anchoredContentHash: "hash-2",
	anchoredCandidateId: CandidateIdSchema.parse("candidate-2"),
	orderKey: 40,
};

describe("initDynamoDbHighlightAnchors", () => {
	it("lists every reader's highlights of an article across GSI pages", async () => {
		const table = createFakeTable();
		for (const n of [1, 2, 3]) table.seed(aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(n) }));
		table.seed(aRow({ userId: OTHER_USER, highlightOf: URL_ID, highlightId: idOf(4) }));
		table.seed(aRow({ userId: USER, highlightOf: OTHER_URL_ID, highlightId: idOf(5) }));
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });

		const rows = await store.listHighlightsOfArticle("https://example.com/post");

		expect(rows.map((row) => [row.userId, row.highlight.highlightId])).toEqual([
			[USER, idOf(1)],
			[USER, idOf(2)],
			[USER, idOf(3)],
			[OTHER_USER, idOf(4)],
		]);
		expect(rows[0]?.highlight.anchoredCandidateId).toBe("candidate-1");
		const queries = table.sent.filter((command) => command.name === "QueryCommand");
		expect(queries).toHaveLength(2);
		expect(queries[1]?.input.ExclusiveStartKey).toEqual({ userId: USER, url: aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(2) }).url });
	});

	it("queries the GSI by the url the parser normalises", async () => {
		const table = createFakeTable();
		table.seed(aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(1) }));
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });

		const rows = await store.listHighlightsOfArticle("https://EXAMPLE.com/post");

		expect(rows.map((row) => row.highlight.highlightId)).toEqual([idOf(1)]);
	});

	it("writes the anchor under a compare-and-swap on anchorRevision and bumps it by one", async () => {
		const table = createFakeTable();
		const seeded = aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(1), anchorRevision: 3 });
		table.seed(seeded);
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });

		const result = await store.writeHighlightAnchor({
			userId: USER,
			url: URL_ID,
			highlightId: idOf(1),
			expectedRevision: 3,
			anchor: MOVED,
		});

		expect(result).toEqual({ outcome: "written" });
		expect(table.items.get(rowKey(seeded))).toEqual({
			...seeded,
			start: 40,
			end: 49,
			anchorState: "moved",
			anchoredContentHash: "hash-2",
			anchoredCandidateId: "candidate-2",
			orderKey: 40,
			anchorRevision: 4,
		});
		const sent = table.sent.find((command) => command.name === "UpdateCommand");
		expect(sent?.input.ConditionExpression).toBe("anchorRevision = :expectedRevision AND attribute_exists(#url)");
		expect(sent?.input.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
		expect(sent?.input.TableName).toBe(TABLE);
	});

	it("removes the anchored candidate id when the new anchor has none", async () => {
		const table = createFakeTable();
		const seeded = aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(1) });
		table.seed(seeded);
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });
		const { anchoredCandidateId: _dropped, ...withoutCandidate } = MOVED;

		await store.writeHighlightAnchor({
			userId: USER,
			url: URL_ID,
			highlightId: idOf(1),
			expectedRevision: 0,
			anchor: withoutCandidate,
		});

		expect(table.items.get(rowKey(seeded))?.anchoredCandidateId).toBeUndefined();
		expect(table.items.get(rowKey(seeded))?.anchorRevision).toBe(1);
	});

	it("answers deleted when the row is gone", async () => {
		const table = createFakeTable();
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });

		const result = await store.writeHighlightAnchor({
			userId: USER,
			url: URL_ID,
			highlightId: idOf(1),
			expectedRevision: 0,
			anchor: MOVED,
		});

		expect(result).toEqual({ outcome: "deleted" });
	});

	it("answers stale and leaves the row when another write moved its revision on", async () => {
		const table = createFakeTable();
		const seeded = aRow({ userId: USER, highlightOf: URL_ID, highlightId: idOf(1), anchorRevision: 2 });
		table.seed(seeded);
		const store = initDynamoDbHighlightAnchors({ client: table.client, userArticlesTableName: TABLE });

		const result = await store.writeHighlightAnchor({
			userId: USER,
			url: URL_ID,
			highlightId: idOf(1),
			expectedRevision: 1,
			anchor: MOVED,
		});

		expect(result).toEqual({ outcome: "stale" });
		expect(table.items.get(rowKey(seeded))).toEqual(seeded);
	});

	it("rethrows a failure that is not a lost condition", async () => {
		const client = {
			send: async () => {
				throw new Error("throttled");
			},
		} as unknown as DynamoDBDocumentClient;
		const store = initDynamoDbHighlightAnchors({ client, userArticlesTableName: TABLE });

		await expect(
			store.writeHighlightAnchor({ userId: USER, url: URL_ID, highlightId: idOf(1), expectedRevision: 0, anchor: MOVED }),
		).rejects.toThrow("throttled");
	});
});
