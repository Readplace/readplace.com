import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { UserIdSchema } from "../user";
import { emailIssueArticleUrl, emailIssueKeyPrefix, emailIssueReceivedAt, parseEmailIssueArticleUrl } from "./email-issue-url";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<m@x>";

describe("emailIssueArticleUrl", () => {
	it("keys an issue by its reader and its sort key, each kept to one path segment", () => {
		assert.equal(
			emailIssueArticleUrl({ userId: READER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID }),
			"email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E",
		);
	});
});

describe("emailIssueReceivedAt", () => {
	it("is the receipt instant before the first # of the sort key", () => {
		assert.equal(emailIssueReceivedAt("2026-06-24T09:00:00.000Z#<m#1@x>"), "2026-06-24T09:00:00.000Z");
	});
});

describe("parseEmailIssueArticleUrl", () => {
	it("reads back the reader and sort key an issue was saved under", () => {
		const url = emailIssueArticleUrl({ userId: READER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID });

		assert.deepEqual(parseEmailIssueArticleUrl(url), {
			userId: READER,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});
	});

	it("does not read a web article as an issue", () => {
		assert.equal(parseEmailIssueArticleUrl("https://example.com/inbox/a/b"), undefined);
	});
});

describe("emailIssueKeyPrefix", () => {
	it("is the stored key every issue saved for the reader starts with", () => {
		const userId = UserIdSchema.parse("reader+1@example.com/x");
		const storedKey = ArticleResourceUniqueId.parse(
			emailIssueArticleUrl({ userId, receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>" }),
		).value;

		assert.equal(emailIssueKeyPrefix(userId), "inbox/reader%2B1%40example.com%2Fx/");
		assert.ok(storedKey.startsWith(emailIssueKeyPrefix(userId)));
	});

	it("does not match another reader's issues", () => {
		const storedKey = ArticleResourceUniqueId.parse(
			emailIssueArticleUrl({ userId: UserIdSchema.parse("reader-10"), receivedAtMessageId: "a#b" }),
		).value;

		assert.ok(!storedKey.startsWith(emailIssueKeyPrefix(UserIdSchema.parse("reader-1"))));
	});
});
