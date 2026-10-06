import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import { emailIssueArticleUrl, parseEmailIssueArticleUrl } from "./email-issue-url";

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
