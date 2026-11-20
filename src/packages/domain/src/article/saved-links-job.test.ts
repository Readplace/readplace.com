import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import type { NewsletterLinkRow } from "./newsletter-link";
import {
	SavedLinksJobCountsSchema,
	decideHold,
	heldLinkExpiresAt,
	isHeldLinkLive,
} from "./saved-links-job";

const READER = UserIdSchema.parse("reader-1");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");

function emailLink(overrides: Partial<NewsletterLinkRow> = {}): NewsletterLinkRow {
	return {
		storedKey: "example.com/post",
		status: "unread",
		savedAt: new Date("2026-11-20T00:00:00.000Z"),
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		...overrides,
	};
}

describe("decideHold", () => {
	it("holds an unread, unopened newsletter link saved before the cutoff", () => {
		assert.deepEqual(decideHold({ row: emailLink(), userId: READER, cutoff: CUTOFF, senders: { kind: "all" } }), {
			kind: "hold",
		});
	});

	it("does not select a row that is not a newsletter link", () => {
		const row = emailLink({ provenance: { kind: "web" } });
		assert.deepEqual(decideHold({ row, userId: READER, cutoff: CUTOFF, senders: { kind: "all" } }), {
			kind: "not-selected",
		});
	});

	it("does not select a newsletter link from a sender the reader did not choose, even one it would skip", () => {
		const row = emailLink({ status: "read" });
		const senders = { kind: "chosen" as const, senderEmails: ["other@news.com"] };
		assert.deepEqual(decideHold({ row, userId: READER, cutoff: CUTOFF, senders }), { kind: "not-selected" });
	});

	it("holds a newsletter link from a chosen sender", () => {
		const senders = { kind: "chosen" as const, senderEmails: ["dan@tldr.tech"] };
		assert.deepEqual(decideHold({ row: emailLink(), userId: READER, cutoff: CUTOFF, senders }), { kind: "hold" });
	});

	it("skips a read link with the classifier's reason", () => {
		const row = emailLink({ status: "read" });
		assert.deepEqual(decideHold({ row, userId: READER, cutoff: CUTOFF, senders: { kind: "all" } }), {
			kind: "skipped",
			reason: "read",
		});
	});
});

describe("held link expiry", () => {
	const removedAt = new Date("2026-11-20T10:00:00.000Z");

	it("expires 30 days after removal", () => {
		assert.equal(heldLinkExpiresAt(removedAt).toISOString(), "2026-12-20T10:00:00.000Z");
	});

	it("is live before its expiry and not at it", () => {
		const expiresAt = heldLinkExpiresAt(removedAt);
		assert.equal(isHeldLinkLive({ link: { expiresAt }, now: new Date(expiresAt.getTime() - 1) }), true);
		assert.equal(isHeldLinkLive({ link: { expiresAt }, now: expiresAt }), false);
	});
});

describe("SavedLinksJobCountsSchema", () => {
	it("takes counts by code and refuses an unknown code", () => {
		assert.deepEqual(SavedLinksJobCountsSchema.parse({ held: 3, read: 1 }), { held: 3, read: 1 });
		assert.equal(SavedLinksJobCountsSchema.safeParse({ other: 1 }).success, false);
	});
});
