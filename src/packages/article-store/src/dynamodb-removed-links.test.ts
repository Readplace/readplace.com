import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { emailIssueArticleUrl } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbRemovedLinks } from "./dynamodb-removed-links";

type Item = Record<string, unknown>;

const PAGE_SIZE = 2;
const TABLE = "user-articles";
const READER = UserIdSchema.parse("reader-1");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");
const ISSUE_KEY = ArticleResourceUniqueId.parse(
	emailIssueArticleUrl({ userId: READER, receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>" }),
).value;

function createFakeTable(seed: Item[], sharedArticles: Item[] = []) {
	const sent: Record<string, unknown>[] = [];
	const send = async (command: { input: Record<string, unknown> }) => {
		const { input } = command;
		sent.push(input);
		if (input.RequestItems !== undefined) {
			const [[tableName, request]] = Object.entries(Object(input.RequestItems));
			const keys: Item[] = Object(request).Keys;
			const rows = tableName === TABLE ? seed : sharedArticles;
			return {
				Responses: {
					[tableName]: rows.filter((row) =>
						keys.some((key) => key.url === row.url && (key.userId === undefined || key.userId === row.userId)),
					),
				},
			};
		}
		const values = Object(input.ExpressionAttributeValues);
		const prefix = String(values[":issueKeyPrefix"] ?? values[":keyPrefix"] ?? values[":prefix"] ?? "");
		const matching = seed
			.filter((item) => item.userId === values[":userId"] && String(item.url).startsWith(prefix))
			.sort((a, b) => String(a.url).localeCompare(String(b.url)));
		const startKey = input.ExclusiveStartKey;
		const startAt = startKey === undefined ? 0 : matching.findIndex((item) => item.url === Object(startKey).url) + 1;
		const page = matching.slice(startAt, startAt + PAGE_SIZE);
		const last = page.at(-1);
		const more = startAt + PAGE_SIZE < matching.length;
		return {
			...(input.Select === "COUNT" ? {} : { Items: page }),
			Count: page.length,
			...(more && last ? { LastEvaluatedKey: { userId: last.userId, url: last.url } } : {}),
		};
	};
	const removedLinks = initDynamoDbRemovedLinks({
		client: { send } as unknown as DynamoDBDocumentClient,
		userArticlesTableName: TABLE,
		articlesTableName: "articles",
	});
	return { removedLinks, sent };
}

function emailLink(url: string, overrides: Item = {}): Item {
	return {
		userId: READER,
		url,
		status: "unread",
		savedAt: "2026-11-20T00:00:00.000Z",
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		...overrides,
	};
}

describe("hasNewsletterLink", () => {
	it("pages the All partition with a projection and no filter, and stops at the first newsletter link", async () => {
		const { removedLinks, sent } = createFakeTable([
			{ userId: READER, url: "a.com/0", status: "unread", savedAt: "2026-11-20T00:00:00.000Z" },
			emailLink("a.com/1", { handPickedAt: "2026-11-19T00:00:00.000Z" }),
			{ userId: READER, url: "a.com/2", status: "unread" },
			emailLink("a.com/3"),
			emailLink("a.com/4"),
			emailLink("a.com/5"),
		]);

		assert.equal(await removedLinks.hasNewsletterLink({ userId: READER }), true);
		assert.equal(sent[0].TableName, TABLE);
		assert.equal(sent[0].KeyConditionExpression, "userId = :userId");
		assert.equal(sent[0].FilterExpression, undefined);
		assert.equal(sent[0].Limit, 300);
		assert.equal(sent[0].ProjectionExpression, "#url, #status, #savedAt, #provenance, #restoredAt");
		assert.equal(sent.length, 1);
	});

	it("is false when no row is a newsletter link", async () => {
		const { removedLinks, sent } = createFakeTable([
			emailLink("a.com/1", { provenance: { kind: "web" } }),
			emailLink(ISSUE_KEY),
			emailLink("readplace:queue-def/work"),
		]);

		assert.equal(await removedLinks.hasNewsletterLink({ userId: READER }), false);
		assert.equal(sent.length, 2);
	});
});

describe("summariseNewsletterLinks", () => {
	it("walks the partition once, leaves out issues and store rows, and skips highlighted, restored and unreadable links", async () => {
		const { removedLinks, sent } = createFakeTable([
			emailLink("a.com/1"),
			emailLink("a.com/2", { viewedAt: "2026-11-21T00:00:00.000Z" }),
			emailLink("a.com/3"),
			emailLink("a.com/4", { savedAt: 7 }),
			emailLink(ISSUE_KEY),
			emailLink("readplace:queue-def/work"),
			{ userId: READER, url: "readplace:highlight/a.com/3/h1", highlightOf: "a.com/3" },
			emailLink("b.com/1", { userId: "reader-2" }),
			emailLink("a.com/5"),
			emailLink("a.com/6", { lastSummaryOpenedAt: "2026-11-21T00:00:00.000Z" }),
			emailLink("a.com/7", { restoredAt: CUTOFF.toISOString() }),
			{ userId: `${READER}#queue/work`, url: "a.com/5", viewedAt: "2026-11-21T00:00:00.000Z" },
			{ userId: `${READER}#queue/work`, url: "a.com/1" },
		]);

		const summary = await removedLinks.summariseNewsletterLinks({ userId: READER, cutoff: CUTOFF });

		assert.deepEqual(summary, {
			selected: 4,
			bySender: [{ senderEmail: "dan@tldr.tech", count: 4 }],
			skipped: { read: 0, highlighted: 1, changed: 1, unreadable: 1 },
			earliestEmailSave: new Date("2026-11-20T00:00:00.000Z"),
		});
		assert.equal(sent.length, 5);
		assert.equal(sent[0].ProjectionExpression, "#url, #status, #savedAt, #provenance, #restoredAt, #highlightOf");
		assert.equal(sent[0].FilterExpression, undefined);
	});
});

describe("countNewsletterIssues", () => {
	it("counts the reader's issue keys across pages without reading their items", async () => {
		const otherIssue = ArticleResourceUniqueId.parse(
			emailIssueArticleUrl({ userId: READER, receivedAtMessageId: "2026-06-25T09:00:00.000Z#<n@x>" }),
		).value;
		const thirdIssue = ArticleResourceUniqueId.parse(
			emailIssueArticleUrl({ userId: READER, receivedAtMessageId: "2026-06-26T09:00:00.000Z#<o@x>" }),
		).value;
		const { removedLinks, sent } = createFakeTable([
			emailLink(ISSUE_KEY),
			emailLink(otherIssue),
			emailLink(thirdIssue),
			emailLink("a.com/1"),
		]);

		assert.equal(await removedLinks.countNewsletterIssues({ userId: READER }), 3);
		assert.equal(sent.length, 2);
		assert.equal(sent[0].KeyConditionExpression, "userId = :userId AND begins_with(#url, :issueKeyPrefix)");
		assert.equal(sent[0].Select, "COUNT");
		assert.deepEqual(sent[0].ExpressionAttributeValues, { ":userId": READER, ":issueKeyPrefix": "inbox/reader-1/" });
	});
});

describe("forEachRemovalCandidatePage", () => {
	it("hands over each page's links, leaving out issues and store rows, and marks an unreadable row", async () => {
		const { removedLinks, sent } = createFakeTable([
			emailLink("a.com/1"),
			emailLink("a.com/2", { savedAt: 7 }),
			emailLink(ISSUE_KEY),
			emailLink("readplace:queue-def/work"),
			{ userId: READER, url: "readplace:highlight/a.com/1/h1", highlightOf: "a.com/1" },
			emailLink("a.com/3"),
		]);
		const pages: unknown[][] = [];

		await removedLinks.forEachRemovalCandidatePage({
			userId: READER,
			onPage: async (candidates) => {
				pages.push(candidates.map((candidate) => (candidate.kind === "row" ? candidate.row.storedKey : candidate.kind)));
			},
		});

		assert.deepEqual(pages, [["a.com/1", "unreadable"], ["a.com/3"], []]);
		assert.equal(sent[0].ProjectionExpression, "#url, #status, #savedAt, #provenance, #restoredAt");
		assert.equal(sent[0].FilterExpression, undefined);
	});
});

describe("findUnrestorableArticles", () => {
	it("finds the stored keys whose shared article row is gone or purged", async () => {
		const { removedLinks, sent } = createFakeTable(
			[],
			[{ url: "a.com/1" }, { url: "a.com/2", purgedAt: "2026-12-01T00:00:00.000Z" }],
		);

		const found = await removedLinks.findUnrestorableArticles({ storedKeys: ["a.com/1", "a.com/2", "a.com/3"] });

		assert.deepEqual([...found].sort(), ["a.com/2", "a.com/3"]);
		assert.deepEqual(Object(sent[0].RequestItems).articles.ExpressionAttributeNames, { "#url": "url", "#purgedAt": "purgedAt" });
	});
});

describe("findKeysInAll", () => {
	it("finds the stored keys the reader already has in All", async () => {
		const { removedLinks, sent } = createFakeTable([emailLink("a.com/1"), { ...emailLink("a.com/2"), userId: "reader-2" }]);

		const found = await removedLinks.findKeysInAll({ userId: READER, storedKeys: ["a.com/1", "a.com/2"] });

		assert.deepEqual([...found], ["a.com/1"]);
		assert.deepEqual(Object(sent[0].RequestItems)[TABLE].Keys, [
			{ userId: READER, url: "a.com/1" },
			{ userId: READER, url: "a.com/2" },
		]);
		assert.equal(Object(sent[0].RequestItems)[TABLE].ProjectionExpression, "#url");
	});
});

describe("findOriginalUrls", () => {
	it("reads each stored key's original URL from the articles table", async () => {
		const { removedLinks, sent } = createFakeTable(
			[],
			[
				{ url: "a.com/1", originalUrl: "https://a.com/1?utm=x" },
				{ url: "a.com/2", originalUrl: "https://a.com/2" },
			],
		);

		const found = await removedLinks.findOriginalUrls({ storedKeys: ["a.com/1", "a.com/3"] });

		assert.deepEqual([...found], [["a.com/1", "https://a.com/1?utm=x"]]);
		assert.deepEqual(Object(sent[0].RequestItems).articles.Keys, [{ url: "a.com/1" }, { url: "a.com/3" }]);
	});

	it("reads nothing when there are no keys", async () => {
		const { removedLinks, sent } = createFakeTable([]);

		assert.equal((await removedLinks.findOriginalUrls({ storedKeys: [] })).size, 0);
		assert.equal(sent.length, 0);
	});
});
