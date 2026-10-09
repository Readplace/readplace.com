import assert from "node:assert/strict";
import { MAX_ARTICLE_TOPIC_LENGTH, toArticleTopics } from "./article-topic";

describe("toArticleTopics", () => {
	it("trims each label and collapses the whitespace inside it", () => {
		assert.deepEqual(toArticleTopics(["  Personal \n  finance  "]), ["Personal finance"]);
	});

	it("drops a label with no characters in it", () => {
		assert.deepEqual(toArticleTopics(["", "   ", "Focus"]), ["Focus"]);
	});

	it("drops a label past the length cap rather than truncating it, and keeps one at the cap", () => {
		const atCap = "a".repeat(MAX_ARTICLE_TOPIC_LENGTH);
		const pastCap = "b".repeat(MAX_ARTICLE_TOPIC_LENGTH + 1);

		assert.deepEqual(toArticleTopics([pastCap, atCap]), [atCap]);
	});

	it("drops the labels a list reserves for its own catch-all, whatever their case", () => {
		assert.deepEqual(toArticleTopics(["others", "Other", "MISC", "Trends"]), ["Trends"]);
	});

	it("drops a later label that repeats an earlier one in another case, keeping the first", () => {
		assert.deepEqual(toArticleTopics(["Remote work", "remote Work", "Culture"]), ["Remote work", "Culture"]);
	});

	it("keeps the first three topics in the order they were named", () => {
		assert.deepEqual(toArticleTopics(["Productivity", "Focus", "Lifestyle", "Habits"]), [
			"Productivity",
			"Focus",
			"Lifestyle",
		]);
	});

	it("keeps a label's casing as written, so a proper noun survives", () => {
		assert.deepEqual(toArticleTopics(["JavaScript"]), ["JavaScript"]);
	});
});
