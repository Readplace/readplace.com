import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/article-state-types";
import { type Highlight, type HighlightId, HighlightIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/storage-client";
import { initDynamoDbHighlights } from "./dynamodb-highlights";

type Item = Record<string, unknown>;
type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

const PAGE_SIZE = 2;

function rowKey(item: Item): string {
	return `${String(item.userId)}|${String(item.url)}`;
}

function createFakeTable(options: { transactionError?: Error } = {}) {
	const items = new Map<string, Item>();
	const sent: { name: string; input: Record<string, unknown> }[] = [];

	const conditionFails = (input: Record<string, unknown>, existing: Item | undefined) =>
		(input.ConditionExpression === "attribute_not_exists(#url)" && existing !== undefined) ||
		(input.ConditionExpression === "attribute_exists(#url)" && existing === undefined);

	const conditionalCheckFailed = () =>
		new ConditionalCheckFailedException({ message: "conditional", $metadata: {} });

	const query = (input: Record<string, unknown>) => {
		const values = input.ExpressionAttributeValues;
		assert(values !== null && typeof values === "object");
		const attributeValue = (name: string) => Object.entries(values).find(([key]) => key === name)?.[1];
		const userId = attributeValue(":userId");
		const prefix = String(attributeValue(":prefix"));
		const matching = [...items.values()]
			.filter((item) => item.userId === userId && String(item.url).startsWith(prefix))
			.sort((a, b) => String(a.url).localeCompare(String(b.url)));
		const startKey = input.ExclusiveStartKey;
		const startAt =
			startKey === undefined ? 0 : matching.findIndex((item) => rowKey(item) === rowKey(Object(startKey))) + 1;
		const page = matching.slice(startAt, startAt + PAGE_SIZE);
		const last = page.at(-1);
		const more = startAt + PAGE_SIZE < matching.length;
		const filtered =
			input.FilterExpression === undefined
				? page
				: page.filter((item) => item.highlightOf === attributeValue(":highlightOf"));
		return {
			Items: filtered,
			Count: filtered.length,
			...(more && last ? { LastEvaluatedKey: { userId: last.userId, url: last.url } } : {}),
		};
	};

	const send = async (command: SentCommand) => {
		sent.push({ name: command.constructor.name, input: command.input });
		const { input } = command;
		switch (command.constructor.name) {
			case "QueryCommand":
				return query(input);
			case "PutCommand": {
				const item = Object(input.Item);
				if (conditionFails(input, items.get(rowKey(item)))) throw conditionalCheckFailed();
				items.set(rowKey(item), item);
				return {};
			}
			case "UpdateCommand": {
				const key = rowKey(Object(input.Key));
				const existing = items.get(key);
				if (conditionFails(input, existing)) throw conditionalCheckFailed();
				assert(existing);
				const values = Object(input.ExpressionAttributeValues);
				const { note: oldNote, ...rest } = existing;
				const updated: Item = { ...rest, updatedAt: values[":updatedAt"] };
				if (String(input.UpdateExpression).startsWith("SET #note")) updated.note = values[":note"];
				items.set(key, updated);
				return { Attributes: { updatedAt: existing.updatedAt, ...(oldNote === undefined ? {} : { note: oldNote }) } };
			}
			case "DeleteCommand": {
				const key = rowKey(Object(input.Key));
				if (conditionFails(input, items.get(key))) throw conditionalCheckFailed();
				items.delete(key);
				return {};
			}
			case "TransactWriteCommand": {
				if (options.transactionError) throw options.transactionError;
				const transactItems: { Put?: Item; Delete?: Item }[] = Object(input.TransactItems);
				for (const entry of transactItems) {
					if (entry.Put) items.set(rowKey(Object(entry.Put.Item)), Object(entry.Put.Item));
					if (entry.Delete) items.delete(rowKey(Object(entry.Delete.Key)));
				}
				return {};
			}
			default:
				throw new Error(`unexpected command ${command.constructor.name}`);
		}
	};

	return {
		client: { send } as unknown as DynamoDBDocumentClient,
		items,
		sent,
		seed: (item: Item) => items.set(rowKey(item), item),
	};
}

const TABLE = "user-articles";
const USER = UserIdSchema.parse("abc123");
const OTHER_USER = UserIdSchema.parse("def456");
const ARTICLE = "example.com/x";
const NESTED_ARTICLE = "example.com/x/y";

let idCounter = 0;
function nextId(): HighlightId {
	idCounter += 1;
	return HighlightIdSchema.parse(`00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`);
}

function aHighlight(overrides: Partial<Highlight> = {}): Highlight {
	return {
		highlightId: nextId(),
		highlightOf: ARTICLE,
		exact: "a passage",
		prefix: "before ",
		suffix: " after",
		start: 10,
		end: 19,
		anchoredContentHash: "hash-1",
		anchorState: "anchored",
		orderKey: 10,
		createdAt: new Date("2026-11-01T10:00:00.000Z"),
		updatedAt: new Date("2026-11-01T10:00:00.000Z"),
		anchorRevision: 0,
		...overrides,
	};
}

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbHighlights({ client, userArticlesTableName: TABLE });
}

describe("initDynamoDbHighlights", () => {
	it("creates a highlight under the article's highlight key and lists it back", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const highlight = aHighlight({
			anchoredCandidateId: CandidateIdSchema.parse("candidate-1"),
			note: "a note",
		});

		const outcome = await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

		assert.deepEqual(outcome, { status: "created", highlight, replacedIds: [] });
		assert.deepEqual([...table.items.values()].map((item) => item.url), [
			`readplace:highlight/${ARTICLE}/${highlight.highlightId}`,
		]);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [highlight]);
	});

	it("reads a row without a candidate id or note as a highlight without them", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const highlight = aHighlight();
		await store.createHighlight({ userId: USER, highlight, replacedIds: [] });
		const [stored] = [...table.items.values()];
		assert(stored);
		table.seed({ ...stored, anchoredCandidateId: null, note: null });

		const [listed] = await store.listArticleHighlights({ userId: USER, url: ARTICLE });

		assert.deepEqual(listed, highlight);
		assert.equal(listed && "note" in listed, false);
		assert.equal(listed && "anchoredCandidateId" in listed, false);
	});

	it("answers cancelled when a plain create finds the key already taken", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const highlight = aHighlight();
		await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

		const outcome = await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

		assert.deepEqual(outcome, { status: "cancelled" });
	});

	it("rethrows a create failure that is not a failed condition", async () => {
		const error = new Error("throttled");
		const store = initStore({
			send: async () => {
				throw error;
			},
		} as unknown as DynamoDBDocumentClient);

		await expect(store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [] })).rejects.toBe(
			error,
		);
	});

	it("lists an article's highlights in orderKey order, then by id", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const late = aHighlight({ orderKey: 50 });
		const earlyB = aHighlight({ orderKey: 5 });
		const earlyA = aHighlight({ orderKey: 5 });
		for (const highlight of [late, earlyB, earlyA]) {
			await store.createHighlight({ userId: USER, highlight, replacedIds: [] });
		}

		const listed = await store.listArticleHighlights({ userId: USER, url: ARTICLE });

		assert.deepEqual(
			listed.map((highlight) => highlight.highlightId),
			[earlyB.highlightId, earlyA.highlightId, late.highlightId],
		);
	});

	it("keeps the highlights of /x and /x/y apart", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const onX = aHighlight();
		const onNested = aHighlight({ highlightOf: NESTED_ARTICLE });
		await store.createHighlight({ userId: USER, highlight: onX, replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: onNested, replacedIds: [] });

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [onX]);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: NESTED_ARTICLE }), [onNested]);
	});

	it("merges by writing the new row and deleting each replaced row in one transaction", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const first = aHighlight();
		const second = aHighlight();
		await store.createHighlight({ userId: USER, highlight: first, replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: second, replacedIds: [] });
		const merged = aHighlight({ start: 0, end: 40 });

		const outcome = await store.createHighlight({
			userId: USER,
			highlight: merged,
			replacedIds: [first.highlightId, second.highlightId],
		});

		assert.deepEqual(outcome, {
			status: "merged",
			highlight: merged,
			replacedIds: [first.highlightId, second.highlightId],
		});
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [merged]);
		const transaction = table.sent.find((command) => command.name === "TransactWriteCommand");
		assert(transaction);
		const transactItems: { Put?: Item; Delete?: Item }[] = Object(transaction.input.TransactItems);
		assert.deepEqual(
			transactItems.map((entry) => entry.Put?.ConditionExpression ?? entry.Delete?.ConditionExpression),
			["attribute_not_exists(#url)", "attribute_exists(#url)", "attribute_exists(#url)"],
		);
	});

	it("answers cancelled when DynamoDB cancels the merge transaction", async () => {
		const table = createFakeTable({
			transactionError: new TransactionCanceledException({
				message: "Transaction cancelled",
				$metadata: {},
				CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
			}),
		});
		const store = initStore(table.client);
		const replaced = aHighlight();

		const outcome = await store.createHighlight({
			userId: USER,
			highlight: aHighlight(),
			replacedIds: [replaced.highlightId],
		});

		assert.deepEqual(outcome, { status: "cancelled" });
	});

	it("rethrows a merge failure that is not a cancelled transaction", async () => {
		const error = new Error("throttled");
		const table = createFakeTable({ transactionError: error });
		const store = initStore(table.client);

		await expect(
			store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [nextId()] }),
		).rejects.toBe(error);
	});

	it("deletes one highlight and reports whether it existed", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const kept = aHighlight();
		const removed = aHighlight();
		await store.createHighlight({ userId: USER, highlight: kept, replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: removed, replacedIds: [] });

		assert.deepEqual(
			await store.deleteHighlight({ userId: USER, url: ARTICLE, highlightId: removed.highlightId }),
			{ deleted: true },
		);
		assert.deepEqual(
			await store.deleteHighlight({ userId: USER, url: ARTICLE, highlightId: removed.highlightId }),
			{ deleted: false },
		);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [kept]);
	});

	it("deleteArticleHighlights of /x pages through its rows and leaves /x/y's", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		const onNested = aHighlight({ highlightOf: NESTED_ARTICLE });
		for (const highlight of [aHighlight(), aHighlight(), aHighlight()]) {
			await store.createHighlight({ userId: USER, highlight, replacedIds: [] });
		}
		await store.createHighlight({ userId: USER, highlight: onNested, replacedIds: [] });

		await store.deleteArticleHighlights({ userId: USER, url: ARTICLE });

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), []);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: NESTED_ARTICLE }), [onNested]);
	});

	it("deleteAllUserHighlights removes every highlight row of the user over several pages, and nothing else", async () => {
		const table = createFakeTable();
		const store = initStore(table.client);
		for (const url of [ARTICLE, ARTICLE, NESTED_ARTICLE, "example.org/z", "example.org/w"]) {
			await store.createHighlight({ userId: USER, highlight: aHighlight({ highlightOf: url }), replacedIds: [] });
		}
		const otherUsers = aHighlight();
		await store.createHighlight({ userId: OTHER_USER, highlight: otherUsers, replacedIds: [] });
		table.seed({ userId: USER, url: ARTICLE, savedAt: "2026-11-01T10:00:00.000Z" });

		await store.deleteAllUserHighlights(USER);

		assert.deepEqual(
			[...table.items.values()].map((item) => `${String(item.userId)} ${String(item.url)}`).sort(),
			[`${USER} ${ARTICLE}`, `${OTHER_USER} readplace:highlight/${ARTICLE}/${otherUsers.highlightId}`],
		);
		const queries = table.sent.filter((command) => command.name === "QueryCommand");
		assert.equal(queries.length > 1, true);
	});

	describe("updateHighlightNote", () => {
		const EDITED_AT = new Date("2026-11-02T09:00:00.000Z");

		it("sets the note and updatedAt, keeps the anchor revision, and reports a noteless row", async () => {
			const table = createFakeTable();
			const store = initStore(table.client);
			const highlight = aHighlight({ anchorRevision: 3 });
			await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

			const outcome = await store.updateHighlightNote({
				userId: USER,
				url: ARTICLE,
				highlightId: highlight.highlightId,
				note: "first line\nsecond line",
				updatedAt: EDITED_AT,
			});

			assert.deepEqual(outcome, { updated: true, hadNote: false });
			const update = table.sent.find((command) => command.name === "UpdateCommand");
			assert(update);
			assert.equal(update.input.UpdateExpression, "SET #note = :note, updatedAt = :updatedAt");
			assert.equal(update.input.ConditionExpression, "attribute_exists(#url)");
			assert.equal(update.input.ReturnValues, "UPDATED_OLD");
			assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [
				{ ...highlight, note: "first line\nsecond line", updatedAt: EDITED_AT },
			]);
		});

		it("reports hadNote from the old image when it replaces a note", async () => {
			const table = createFakeTable();
			const store = initStore(table.client);
			const highlight = aHighlight({ note: "old" });
			await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

			const outcome = await store.updateHighlightNote({
				userId: USER,
				url: ARTICLE,
				highlightId: highlight.highlightId,
				note: "new",
				updatedAt: EDITED_AT,
			});

			assert.deepEqual(outcome, { updated: true, hadNote: true });
			const [listed] = await store.listArticleHighlights({ userId: USER, url: ARTICLE });
			assert.equal(listed?.note, "new");
		});

		it("removes the note when none is given and reports the note it had", async () => {
			const table = createFakeTable();
			const store = initStore(table.client);
			const highlight = aHighlight({ note: "old" });
			await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

			const outcome = await store.updateHighlightNote({
				userId: USER,
				url: ARTICLE,
				highlightId: highlight.highlightId,
				updatedAt: EDITED_AT,
			});

			assert.deepEqual(outcome, { updated: true, hadNote: true });
			const update = table.sent.find((command) => command.name === "UpdateCommand");
			assert.equal(update?.input.UpdateExpression, "REMOVE #note SET updatedAt = :updatedAt");
			const { note: _removed, ...withoutNote } = highlight;
			assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [
				{ ...withoutNote, updatedAt: EDITED_AT },
			]);
		});

		it("answers updated false when the highlight is gone", async () => {
			const table = createFakeTable();
			const store = initStore(table.client);

			const outcome = await store.updateHighlightNote({
				userId: USER,
				url: ARTICLE,
				highlightId: nextId(),
				note: "a note",
				updatedAt: EDITED_AT,
			});

			assert.deepEqual(outcome, { updated: false, hadNote: false });
			assert.deepEqual([...table.items.values()], []);
		});
	});
});
