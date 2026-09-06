import assert from "node:assert/strict";
import {
	ARTICLE_CARD,
	EMPTY_READLIST,
	READER_CONTENT,
	SCREEN_RESPONSE_OP_IDS,
	assignOp,
	backToReadlistOp,
	filterLink,
	openArticleOp,
	readlistNavLink,
	readlistSwitchOp,
	tabSwitchOp,
	terminalCard,
	unassignButton,
} from "./screen-response-ops";

describe("screen response operations", () => {
	it("names every gated operation exactly once", () => {
		assert.equal(new Set(SCREEN_RESPONSE_OP_IDS).size, SCREEN_RESPONSE_OP_IDS.length);
	});

	it("switches readlists by clicking the nav link of the target slug", () => {
		const op = readlistSwitchOp({ id: "readlist-switch-first", slug: "abc123" });

		assert.equal(op.trigger, 'nav[data-test-readlist-nav] a[data-test-readlist="abc123"]');
		assert.equal(op.navigation, "same-document");
	});

	it("stops the readlist-switch clock only once the target link is the current page", () => {
		const op = readlistSwitchOp({ id: "readlist-switch-subsequent", slug: "abc123" });

		assert.deepEqual(
			op.predicate.required.map((condition) => condition.selector),
			['nav[data-test-readlist-nav] a[data-test-readlist="abc123"][aria-current="page"]'],
		);
	});

	it("accepts either real cards or the empty-readlist notice, and expects cards", () => {
		const op = readlistSwitchOp({ id: "readlist-switch-first", slug: "abc123" });

		assert.deepEqual(
			op.predicate.oneOf.map((condition) => condition.selector),
			[ARTICLE_CARD, EMPTY_READLIST],
		);
		assert.equal(op.expectedOneOf, ARTICLE_CARD);
	});

	it("requires every listing condition to be laid out, not merely present", () => {
		const op = readlistSwitchOp({ id: "readlist-switch-first", slug: "abc123" });

		assert.deepEqual(
			[...op.predicate.required, ...op.predicate.oneOf].map((condition) => condition.laidOut),
			[true, true, true],
		);
	});

	it("distinguishes the two readlist slugs a switch bounces between", () => {
		assert.notEqual(
			readlistSwitchOp({ id: "readlist-switch-first", slug: "alpha" }).trigger,
			readlistSwitchOp({ id: "readlist-switch-first", slug: "bravo" }).trigger,
		);
	});

	it("maps the To-Read and Read tabs onto their rendered filter names", () => {
		assert.equal(
			filterLink("queue"),
			'nav[data-test-filters] a[data-test-filter="unread"]',
		);
		assert.equal(filterLink("done"), 'nav[data-test-filters] a[data-test-filter="read"]');
	});

	it("stops the tab-switch clock on the target tab becoming current", () => {
		const op = tabSwitchOp({ id: "tab-switch-subsequent", tab: "done" });

		assert.equal(op.trigger, filterLink("done"));
		assert.deepEqual(
			op.predicate.required.map((condition) => condition.selector),
			[`${filterLink("done")}[aria-current="page"]`],
		);
	});

	it("stops the assign clock on the readlist tag appearing in the article header", () => {
		const op = assignOp({ slug: "target-readlist" });

		assert.equal(op.trigger, 'button[data-test-assign-readlist="target-readlist"]');
		assert.deepEqual(
			op.predicate.required.map((condition) => condition.selector),
			['#article-header [data-test-readlist-tag="target-readlist"]'],
		);
		assert.equal(op.expectedOneOf, READER_CONTENT);
	});

	it("resets an assign through the tag's own unassign button", () => {
		assert.equal(
			unassignButton("target-readlist"),
			'#article-header [data-test-readlist-tag="target-readlist"] ' +
				'button[data-test-unassign-readlist="target-readlist"]',
		);
	});

	it("opens an article by its card's title link, never by href", () => {
		const op = openArticleOp({ articleId: "hash-42" });

		assert.equal(op.trigger, '[data-test-article="hash-42"] a[data-test-article-title]');
		assert.equal(op.navigation, "same-document");
	});

	it("requires a ready reader slot and a rendered title before the open clock stops", () => {
		const op = openArticleOp({ articleId: "hash-42" });

		assert.deepEqual(
			op.predicate.required.map((condition) => condition.selector),
			[
				'[data-test-reader-slot][data-reader-status="ready"]',
				"#article-header [data-test-reader-title]",
			],
		);
	});

	it("selects a card by terminal crawl state", () => {
		assert.equal(
			terminalCard("hash-42"),
			'[data-test-article="hash-42"][data-card-status="terminal"]',
		);
	});

	it("lands the back link on the default readlist, which is where the reader returns", () => {
		const op = backToReadlistOp();

		assert.equal(op.trigger, "a[data-test-back-link]");
		assert.deepEqual(
			op.predicate.required.map((condition) => condition.selector),
			[`${readlistNavLink("default")}[aria-current="page"]`],
		);
		assert.equal(op.navigation, "new-document");
	});
});
