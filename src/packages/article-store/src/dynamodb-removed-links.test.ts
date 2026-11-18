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

function createFakeTable(seed: Item[]) {
	const sent: Record<string, unknown>[] = [];
	const send = async (command: { input: Record<string, unknown> }) => {
		const { input } = command;
		sent.push(input);
		const values = Object(input.ExpressionAttributeValues);
		const prefix = values[":issueKeyPrefix"] === undefined ? "" : String(values[":issueKeyPrefix"]);
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
		assert.equal(sent.length, 2);
		assert.equal(sent[0].TableName, TABLE);
		assert.equal(sent[0].KeyConditionExpression, "userId = :userId");
		assert.equal(sent[0].FilterExpression, undefined);
		assert.equal(sent[0].ProjectionExpression, "#url, #status, #savedAt, #provenance, #handPickedAt, #viewedAt");
		assert.deepEqual(sent[1].ExclusiveStartKey, { userId: READER, url: "a.com/1" });
	});

	it("is false when no row is a newsletter link", async () => {
		const { removedLinks, sent } = createFakeTable([
			emailLink("a.com/1", { provenance: { kind: "web" } }),
			emailLink(ISSUE_KEY),
			emailLink("a.com/3", { handPickedAt: "2026-11-19T00:00:00.000Z" }),
		]);

		assert.equal(await removedLinks.hasNewsletterLink({ userId: READER }), false);
		assert.equal(sent.length, 2);
	});
});

describe("summariseNewsletterLinks", () => {
	it("walks the partition once, leaves out issues and store rows, and skips highlighted, opened and unreadable links", async () => {
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
			{ userId: `${READER}#queue/work`, url: "a.com/5", viewedAt: "2026-11-21T00:00:00.000Z" },
			{ userId: `${READER}#queue/work`, url: "a.com/1" },
		]);

		const summary = await removedLinks.summariseNewsletterLinks({ userId: READER, cutoff: CUTOFF });

		assert.deepEqual(summary, {
			selected: 1,
			bySender: [{ senderEmail: "dan@tldr.tech", count: 1 }],
			skipped: { read: 0, opened: 2, highlighted: 1, changed: 0, unreadable: 1 },
			earliestEmailSave: new Date("2026-11-20T00:00:00.000Z"),
			savedBeforeMarker: 0,
		});
		assert.equal(sent.length, 5);
		assert.deepEqual(Object(sent[4].ExpressionAttributeValues), { ":userId": `${READER}#queue/work` });
		assert.equal(sent[4].ProjectionExpression, "#url, #viewedAt");
		assert.equal(sent[0].ProjectionExpression, "#url, #status, #savedAt, #provenance, #handPickedAt, #viewedAt, #highlightOf");
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
