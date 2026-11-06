import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initDynamoDbSavedArticleStore } from "./dynamodb-saved-article-store";
import { readlistPartitionValue } from "./user-readlist-partition";

const USER = UserIdSchema.parse("stamp-contract-user");
const URL = "https://example.com/stamped-article";
const WORK = ReadlistSlugSchema.parse("work");
const SAVED_AT = new Date("2026-05-30T09:00:00.000Z");
const FIRST = new Date("2026-05-30T10:00:00.000Z");
const SECOND = new Date("2026-05-30T11:00:00.000Z");

type Placement = { userId: UserId; url: string; readlist?: ReadlistSlug };

type DefaultRowStamps = {
	viewedAt?: string;
	lastSummaryOpenedAt?: string;
	lastSummaryClosedAt?: string;
	emailSentAt?: string;
};

type StampStore = Pick<
	ReturnType<typeof initDynamoDbSavedArticleStore>,
	"markArticleViewed" | "markReadlistArticleViewed" | "markSummaryToggled" | "markReaderReadyEmailSent"
>;

interface StampHarness {
	store: StampStore;
	seedSaved: (placement: Placement) => Promise<void>;
	seedDeleted: (placement: Placement) => Promise<void>;
	readDefaultRows: () => Promise<DefaultRowStamps[]>;
	readReadlistRows: () => Promise<{ viewedAt?: string }[]>;
}

const iso = (value: Date | undefined): string | undefined => value?.toISOString();

function dynamoDbHarness(): StampHarness {
	const rows = new Map<string, Record<string, unknown>>();
	const keyOf = (key: Record<string, unknown>): string =>
		JSON.stringify(Object.fromEntries(Object.entries(key).sort(([a], [b]) => a.localeCompare(b))));
	const partitionOf = (placement: Placement): string =>
		placement.readlist === undefined
			? placement.userId
			: readlistPartitionValue({ userId: placement.userId, readlist: placement.readlist });
	const adapterKey = (placement: Placement) => ({
		userId: partitionOf(placement),
		url: ArticleResourceUniqueId.parse(placement.url).value,
	});

	type UpdateInput = {
		Key: Record<string, unknown>;
		UpdateExpression: string;
		ConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
	const send = async (command: { constructor: { name: string }; input: UpdateInput }) => {
		assert.equal(command.constructor.name, "UpdateCommand");
		const { Key, UpdateExpression, ConditionExpression, ExpressionAttributeValues } = command.input;
		const id = keyOf(Key);
		const row = rows.get(id);
		const conditions = ConditionExpression?.split(" AND ") ?? [];
		const holds = conditions.every((condition) => {
			if (condition === "attribute_exists(savedAt)") return row?.savedAt !== undefined;
			assert.equal(condition, "attribute_not_exists(emailSentAt)");
			return row?.emailSentAt === undefined;
		});
		if (!holds) {
			throw new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
		}
		const setPart = UpdateExpression.replace(/^SET /, "").split(" REMOVE ")[0] ?? "";
		const next: Record<string, unknown> = { ...Key, ...row };
		for (const clause of setPart.split(", ")) {
			const [column, placeholder] = clause.split(" = ");
			assert(column && placeholder, `unparsed SET clause: ${clause}`);
			next[column] = ExpressionAttributeValues?.[placeholder];
		}
		rows.set(id, next);
		return {};
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as DynamoDBDocumentClient["send"] };
	const store = initDynamoDbSavedArticleStore({
		client: client as DynamoDBDocumentClient,
		tableName: "articles",
		userArticlesTableName: "user-articles",
		logger: Logger.from(noopLogger),
		now: () => SAVED_AT,
	});
	const stampOf = (row: Record<string, unknown>, column: string): string | undefined => {
		const value = row[column];
		return typeof value === "string" ? value : undefined;
	};
	const rowsWhere = (readlist: boolean) =>
		[...rows.values()].filter((row) => String(row.userId).includes("#queue/") === readlist);

	return {
		store,
		seedSaved: async (placement) => {
			const key = adapterKey(placement);
			rows.set(keyOf(key), { ...key, status: "unread", savedAt: SAVED_AT.toISOString() });
		},
		seedDeleted: async () => {},
		readDefaultRows: async () =>
			rowsWhere(false).map((row) => ({
				viewedAt: stampOf(row, "viewedAt"),
				lastSummaryOpenedAt: stampOf(row, "lastSummaryOpenedAt"),
				lastSummaryClosedAt: stampOf(row, "lastSummaryClosedAt"),
				emailSentAt: stampOf(row, "emailSentAt"),
			})),
		readReadlistRows: async () =>
			rowsWhere(true).map((row) => ({ viewedAt: stampOf(row, "viewedAt") })),
	};
}

function inMemoryHarness(): StampHarness {
	const twin = initInMemoryArticleStore();
	const save = async (placement: Placement) => {
		const params = {
			userId: placement.userId,
			url: placement.url,
			metadata: { title: "Stamped", siteName: "example.com", excerpt: "", wordCount: 120 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "client", clientName: "chrome" } as const,
			savedAt: SAVED_AT,
		};
		if (placement.readlist === undefined) await twin.saveArticle(params);
		else await twin.saveReadlistArticle({ ...params, readlist: placement.readlist });
	};
	return {
		store: twin,
		seedSaved: save,
		seedDeleted: async (placement) => {
			await save(placement);
			const id = ReaderArticleHashId.from(placement.url);
			const deleted =
				placement.readlist === undefined
					? await twin.deleteArticle(id, placement.userId)
					: await twin.deleteReadlistArticle({ id, userId: placement.userId, readlist: placement.readlist });
			assert.equal(deleted, true);
		},
		readDefaultRows: async () => {
			const toggle = await twin.getSummaryToggleState({ userId: USER, url: URL });
			if (toggle === null) return [];
			const viewed = await twin.findUserArticlesByUrl(URL);
			const digest = await twin.findUnreadSavesForDigest({
				userId: USER,
				savedAtOrBefore: SECOND,
				emailFilter: { kind: "any" },
				limit: 10,
				cursor: undefined,
			});
			return [
				{
					viewedAt: iso(viewed.find((row) => row.userId === USER)?.viewedAt),
					lastSummaryOpenedAt: iso(toggle.lastSummaryOpenedAt),
					lastSummaryClosedAt: iso(toggle.lastSummaryClosedAt),
					emailSentAt: iso(digest.candidates.find((candidate) => candidate.article.url === URL)?.emailSentAt),
				},
			];
		},
		readReadlistRows: async () => {
			const row = await twin.findReadlistArticleById({
				id: ReaderArticleHashId.from(URL),
				userId: USER,
				readlist: WORK,
			});
			return row === null ? [] : [{ viewedAt: iso(row.viewedAt) }];
		},
	};
}

describe.each([
	{ name: "DynamoDB adapter", harness: dynamoDbHarness },
	{ name: "in-memory twin", harness: inMemoryHarness },
])("user-article stamps: the $name maps each stamp the same way (proves the adapter's write mapping matches the twin, not that DynamoDB evaluates conditions)", ({ harness }) => {
	const DEFAULT_ROW = { userId: USER, url: URL };
	const READLIST_ROW = { userId: USER, url: URL, readlist: WORK };

	describe("markArticleViewed", () => {
		it("records viewedAt on a saved row", async () => {
			const h = harness();
			await h.seedSaved(DEFAULT_ROW);
			await h.store.markArticleViewed({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([{ viewedAt: FIRST.toISOString() }]);
		});

		it("resolves on a deleted row and gives it nothing", async () => {
			const h = harness();
			await h.seedDeleted(DEFAULT_ROW);
			await h.store.markArticleViewed({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});

		it("resolves on a row never saved and creates nothing", async () => {
			const h = harness();
			await h.store.markArticleViewed({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});
	});

	describe.each([
		{ state: "open" as const, column: "lastSummaryOpenedAt" },
		{ state: "closed" as const, column: "lastSummaryClosedAt" },
	])("markSummaryToggled $state", ({ state, column }) => {
		it(`records ${column} on a saved row`, async () => {
			const h = harness();
			await h.seedSaved(DEFAULT_ROW);
			await h.store.markSummaryToggled({ userId: USER, url: URL, state, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([{ [column]: FIRST.toISOString() }]);
		});

		it("resolves on a deleted row and gives it nothing", async () => {
			const h = harness();
			await h.seedDeleted(DEFAULT_ROW);
			await h.store.markSummaryToggled({ userId: USER, url: URL, state, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});

		it("resolves on a row never saved and creates nothing", async () => {
			const h = harness();
			await h.store.markSummaryToggled({ userId: USER, url: URL, state, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});
	});

	describe("markReaderReadyEmailSent", () => {
		it("records emailSentAt on a saved row", async () => {
			const h = harness();
			await h.seedSaved(DEFAULT_ROW);
			await h.store.markReaderReadyEmailSent({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([{ emailSentAt: FIRST.toISOString() }]);
		});

		it("keeps the first timestamp when the email is marked sent again", async () => {
			const h = harness();
			await h.seedSaved(DEFAULT_ROW);
			await h.store.markReaderReadyEmailSent({ userId: USER, url: URL, at: FIRST });
			await h.store.markReaderReadyEmailSent({ userId: USER, url: URL, at: SECOND });
			expect(await h.readDefaultRows()).toEqual([{ emailSentAt: FIRST.toISOString() }]);
		});

		it("resolves on a deleted row and gives it nothing", async () => {
			const h = harness();
			await h.seedDeleted(DEFAULT_ROW);
			await h.store.markReaderReadyEmailSent({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});

		it("resolves on a row never saved and creates nothing", async () => {
			const h = harness();
			await h.store.markReaderReadyEmailSent({ userId: USER, url: URL, at: FIRST });
			expect(await h.readDefaultRows()).toEqual([]);
		});
	});

	describe("markReadlistArticleViewed", () => {
		it("records viewedAt on the readlist's saved row", async () => {
			const h = harness();
			await h.seedSaved(READLIST_ROW);
			await h.store.markReadlistArticleViewed({ userId: USER, readlist: WORK, url: URL, at: FIRST });
			expect(await h.readReadlistRows()).toEqual([{ viewedAt: FIRST.toISOString() }]);
		});

		it("resolves on a deleted readlist row and gives it nothing", async () => {
			const h = harness();
			await h.seedDeleted(READLIST_ROW);
			await h.store.markReadlistArticleViewed({ userId: USER, readlist: WORK, url: URL, at: FIRST });
			expect(await h.readReadlistRows()).toEqual([]);
		});

		it("resolves on a readlist row never saved and creates nothing", async () => {
			const h = harness();
			await h.store.markReadlistArticleViewed({ userId: USER, readlist: WORK, url: URL, at: FIRST });
			expect(await h.readReadlistRows()).toEqual([]);
		});
	});
});
