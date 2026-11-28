import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { emailIssueArticleUrl, emailIssueStoredKey } from "../inbox/email-issue-url";
import { UserIdSchema } from "../user";
import {
	type NewsletterLinkRow,
	classifyForRemoval,
	isNewsletterLink,
	summariseNewsletterIssues,
	summariseNewsletterLinkRows,
} from "./newsletter-link";

const READER = UserIdSchema.parse("reader-1");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");
const NONE = new Set<string>();

function link(overrides: Partial<NewsletterLinkRow> = {}): NewsletterLinkRow {
	return {
		storedKey: "example.com/post",
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		status: "unread",
		savedAt: new Date("2026-11-20T00:00:00.000Z"),
		...overrides,
	};
}

describe("isNewsletterLink", () => {
	it("accepts a link an email saved that nobody chose", () => {
		assert.equal(isNewsletterLink({ row: link(), userId: READER }), true);
	});

	it("rejects a link saved another way", () => {
		assert.equal(isNewsletterLink({ row: link({ provenance: { kind: "hn-suggestion", campaignId: "c", snapshotAt: "s", hnItemId: 1, rank: 1 } }), userId: READER }), false);
	});

	it("accepts an email link the reader also chose", () => {
		assert.equal(isNewsletterLink({ row: link({ provenance: { kind: "email", senderEmail: "dan@tldr.tech" } }), userId: READER }), true);
	});

	it("rejects a whole newsletter issue", () => {
		const storedKey = ArticleResourceUniqueId.parse(
			emailIssueArticleUrl({ userId: READER, receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>" }),
		).value;

		assert.equal(isNewsletterLink({ row: link({ storedKey }), userId: READER }), false);
	});

	it("rejects a row the store keeps for itself", () => {
		assert.equal(isNewsletterLink({ row: link({ storedKey: "readplace:highlight/example.com/post/h1" }), userId: READER }), false);
	});
});

describe("classifyForRemoval", () => {
	const classify = (
		row: NewsletterLinkRow,
		sets: { highlighted?: ReadonlySet<string> } = {},
	) =>
		classifyForRemoval({
			row,
			userId: READER,
			highlighted: sets.highlighted ?? NONE,
			cutoff: CUTOFF,
			kind: "link",
		});

	it("selects an unread, unhighlighted newsletter link", () => {
		assert.deepEqual(classify(link()), { kind: "selected" });
	});

	it("does not classify a row that is not a newsletter link", () => {
		assert.deepEqual(classify(link({ provenance: { kind: "web" } })), { kind: "not-a-newsletter-link" });
	});

	it("skips a link saved again after the reader asked", () => {
		assert.deepEqual(classify(link({ savedAt: new Date(CUTOFF.getTime() + 1), status: "read" })), {
			kind: "skipped",
			reason: "changed",
		});
	});

	it("selects a link saved exactly at the cutoff", () => {
		assert.deepEqual(classify(link({ savedAt: CUTOFF })), { kind: "selected" });
	});

	it("skips a link the reader marked read", () => {
		assert.deepEqual(classify(link({ status: "read" })), { kind: "skipped", reason: "read" });
	});

	it("skips a link restored at or after the cutoff as changed", () => {
		assert.deepEqual(classify(link({ restoredAt: CUTOFF, status: "read" })), { kind: "skipped", reason: "changed" });
	});

	it("selects a link restored before the cutoff", () => {
		assert.deepEqual(classify(link({ restoredAt: new Date("2026-11-25T00:00:00.000Z") })), { kind: "selected" });
	});

	it("classifies an issue only when asked for issues, by the same skip rules", () => {
		const issue = link({ storedKey: emailIssueStoredKey({ userId: READER, receivedAtMessageId: "2026-11-20T00:00:00.000Z#<m@x>" }) });
		const asIssue = (row: NewsletterLinkRow, highlighted: ReadonlySet<string> = NONE) =>
			classifyForRemoval({ row, userId: READER, highlighted, cutoff: CUTOFF, kind: "issue" });

		assert.deepEqual(classify(issue), { kind: "not-a-newsletter-link" });
		assert.deepEqual(asIssue(issue), { kind: "selected" });
		assert.deepEqual(asIssue({ ...issue, status: "read" }), { kind: "skipped", reason: "read" });
		assert.deepEqual(asIssue(issue, new Set([issue.storedKey])), { kind: "skipped", reason: "highlighted" });
		assert.deepEqual(asIssue(link()), { kind: "not-a-newsletter-link" });
		assert.deepEqual(asIssue({ ...issue, provenance: { kind: "web" } }), { kind: "not-a-newsletter-link" });
	});

	it("skips a link the reader highlighted", () => {
		assert.deepEqual(classify(link(), { highlighted: new Set(["example.com/post"]) }), { kind: "skipped", reason: "highlighted" });
	});
});

describe("summariseNewsletterLinkRows", () => {
	it("counts an empty partition as nothing to remove", () => {
		assert.deepEqual(summariseNewsletterLinkRows({ candidates: [], userId: READER, highlighted: NONE, cutoff: CUTOFF }), {
			selected: 0,
			bySender: [],
			skipped: { read: 0, highlighted: 0, changed: 0, unreadable: 0 },
			earliestEmailSave: undefined,
		});
	});

	it("tallies selected links by sender and skips by reason", () => {
		const earliest = new Date("2026-11-01T00:00:00.000Z");
		const summary = summariseNewsletterLinkRows({
			candidates: [
				{ kind: "row", row: link({ storedKey: "a.com/1", provenance: { kind: "email", senderEmail: "b@x" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/2", provenance: { kind: "email", senderEmail: "a@x" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/3", provenance: { kind: "email", senderEmail: "c@x" }, savedAt: earliest }) },
				{ kind: "row", row: link({ storedKey: "a.com/4", provenance: { kind: "email", senderEmail: "c@x" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/5", status: "read" }) },
				{ kind: "row", row: link({ storedKey: "a.com/6" }) },
				{ kind: "row", row: link({ storedKey: "a.com/7", provenance: { kind: "web" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/8" }) },
				{ kind: "unreadable" },
			],
			userId: READER,
			highlighted: new Set(["a.com/6"]),
			cutoff: CUTOFF,
		});

		assert.deepEqual(summary, {
			selected: 5,
			bySender: [
				{ senderEmail: "c@x", count: 2 },
				{ senderEmail: "a@x", count: 1 },
				{ senderEmail: "b@x", count: 1 },
				{ senderEmail: "dan@tldr.tech", count: 1 },
			],
			skipped: { read: 1, highlighted: 1, changed: 0, unreadable: 1 },
			earliestEmailSave: earliest,
		});
	});
});

describe("summariseNewsletterIssues", () => {
	it("counts the issues received by the cutoff by sender, and the read and highlighted ones apart", () => {
		const summary = summariseNewsletterIssues({
			cutoff: CUTOFF,
			emails: [
				{ senderEmail: "a@x", receivedAt: "2026-11-20T00:00:00.000Z", issueState: { kind: "selected" } },
				{ senderEmail: "a@x", receivedAt: "2026-11-21T00:00:00.000Z", issueState: undefined },
				{ senderEmail: "b@x", receivedAt: "2026-11-21T00:00:00.000Z", issueState: undefined },
				{ senderEmail: "b@x", receivedAt: "2026-11-22T00:00:00.000Z", issueState: { kind: "skipped", reason: "read" } },
				{ senderEmail: "b@x", receivedAt: "2026-11-22T00:00:00.000Z", issueState: { kind: "skipped", reason: "highlighted" } },
				{ senderEmail: "b@x", receivedAt: "2026-11-22T00:00:00.000Z", issueState: { kind: "skipped", reason: "changed" } },
				{ senderEmail: "c@x", receivedAt: "2026-12-02T00:00:00.000Z", issueState: undefined },
			],
		});

		assert.deepEqual(summary, {
			selected: 3,
			bySender: [
				{ senderEmail: "a@x", count: 2 },
				{ senderEmail: "b@x", count: 1 },
			],
			skipped: { read: 1, highlighted: 1 },
		});
	});

	it("orders senders with the same count by address", () => {
		const summary = summariseNewsletterIssues({
			cutoff: CUTOFF,
			emails: [
				{ senderEmail: "b@x", receivedAt: "2026-11-20T00:00:00.000Z", issueState: undefined },
				{ senderEmail: "a@x", receivedAt: "2026-11-21T00:00:00.000Z", issueState: undefined },
			],
		});

		assert.deepEqual(summary.bySender, [
			{ senderEmail: "a@x", count: 1 },
			{ senderEmail: "b@x", count: 1 },
		]);
	});
});
