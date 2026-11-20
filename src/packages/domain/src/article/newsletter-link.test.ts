import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { emailIssueArticleUrl } from "../inbox/email-issue-url";
import { UserIdSchema } from "../user";
import { HAND_PICKED_MARKER_SINCE } from "./hand-picked-marker";
import {
	type NewsletterLinkRow,
	classifyForRemoval,
	isHandPicked,
	isNewsletterLink,
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

describe("isHandPicked", () => {
	it("is hand-picked when the reader chose the save", () => {
		assert.equal(isHandPicked(link({ handPickedAt: new Date() })), true);
	});

	it("is hand-picked when the provenance is one an automatic save never overwrites", () => {
		assert.equal(isHandPicked(link({ provenance: { kind: "web" } })), true);
		assert.equal(isHandPicked(link({ provenance: undefined })), true);
	});

	it("is not hand-picked for an email save nobody chose", () => {
		assert.equal(isHandPicked(link()), false);
	});
});

describe("isNewsletterLink", () => {
	it("accepts a link an email saved that nobody chose", () => {
		assert.equal(isNewsletterLink({ row: link(), userId: READER }), true);
	});

	it("rejects a link saved another way", () => {
		assert.equal(isNewsletterLink({ row: link({ provenance: { kind: "hn-suggestion", campaignId: "c", snapshotAt: "s", hnItemId: 1, rank: 1 } }), userId: READER }), false);
	});

	it("rejects an email link the reader also chose", () => {
		assert.equal(isNewsletterLink({ row: link({ handPickedAt: new Date() }), userId: READER }), false);
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
		sets: { highlighted?: ReadonlySet<string>; openedInReadlists?: ReadonlySet<string> } = {},
	) =>
		classifyForRemoval({
			row,
			userId: READER,
			highlighted: sets.highlighted ?? NONE,
			openedInReadlists: sets.openedInReadlists ?? NONE,
			cutoff: CUTOFF,
		});

	it("selects an unread, unopened, unhighlighted newsletter link", () => {
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
		assert.deepEqual(classify(link({ status: "read", viewedAt: new Date() })), { kind: "skipped", reason: "read" });
	});

	it("skips a link the reader opened", () => {
		assert.deepEqual(classify(link({ viewedAt: new Date() }), { highlighted: new Set(["example.com/post"]) }), {
			kind: "skipped",
			reason: "opened",
		});
	});

	it("skips a link the reader opened only from a named readlist", () => {
		assert.deepEqual(classify(link(), { openedInReadlists: new Set(["example.com/post"]) }), {
			kind: "skipped",
			reason: "opened",
		});
	});

	it("skips a link whose summary the reader opened", () => {
		assert.deepEqual(classify(link({ lastSummaryOpenedAt: new Date("2026-11-21T00:00:00.000Z") })), {
			kind: "skipped",
			reason: "opened",
		});
	});

	it("skips a link restored at or after the cutoff as changed", () => {
		assert.deepEqual(classify(link({ restoredAt: CUTOFF, status: "read" })), { kind: "skipped", reason: "changed" });
	});

	it("selects a link restored before the cutoff", () => {
		assert.deepEqual(classify(link({ restoredAt: new Date("2026-11-25T00:00:00.000Z") })), { kind: "selected" });
	});

	it("skips a link the reader highlighted", () => {
		assert.deepEqual(classify(link(), { highlighted: new Set(["example.com/post"]) }), { kind: "skipped", reason: "highlighted" });
	});
});

describe("summariseNewsletterLinkRows", () => {
	it("counts an empty partition as nothing to remove", () => {
		assert.deepEqual(summariseNewsletterLinkRows({ candidates: [], userId: READER, highlighted: NONE, openedInReadlists: NONE, cutoff: CUTOFF }), {
			selected: 0,
			bySender: [],
			skipped: { read: 0, opened: 0, highlighted: 0, changed: 0, unreadable: 0 },
			earliestEmailSave: undefined,
			savedBeforeMarker: 0,
		});
	});

	it("tallies selected links by sender, skips by reason, and the saves older than the marker", () => {
		const beforeMarker = new Date(HAND_PICKED_MARKER_SINCE.getTime() - 1);
		const summary = summariseNewsletterLinkRows({
			candidates: [
				{ kind: "row", row: link({ storedKey: "a.com/1", provenance: { kind: "email", senderEmail: "b@x" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/2", provenance: { kind: "email", senderEmail: "a@x" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/3", provenance: { kind: "email", senderEmail: "c@x" }, savedAt: beforeMarker }) },
				{ kind: "row", row: link({ storedKey: "a.com/4", provenance: { kind: "email", senderEmail: "c@x" }, savedAt: HAND_PICKED_MARKER_SINCE }) },
				{ kind: "row", row: link({ storedKey: "a.com/5", status: "read" }) },
				{ kind: "row", row: link({ storedKey: "a.com/6" }) },
				{ kind: "row", row: link({ storedKey: "a.com/7", provenance: { kind: "web" } }) },
				{ kind: "row", row: link({ storedKey: "a.com/8" }) },
				{ kind: "unreadable" },
			],
			userId: READER,
			highlighted: new Set(["a.com/6"]),
			openedInReadlists: new Set(["a.com/8"]),
			cutoff: CUTOFF,
		});

		assert.deepEqual(summary, {
			selected: 4,
			bySender: [
				{ senderEmail: "c@x", count: 2 },
				{ senderEmail: "a@x", count: 1 },
				{ senderEmail: "b@x", count: 1 },
			],
			skipped: { read: 1, opened: 1, highlighted: 1, changed: 0, unreadable: 1 },
			earliestEmailSave: beforeMarker,
			savedBeforeMarker: 1,
		});
	});
});
