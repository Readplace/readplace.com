import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import type { NewsletterLinkRow } from "./newsletter-link";
import {
	type HeldLink,
	SavedLinksJobCountsSchema,
	SavedLinksJobIdSchema,
	addSavedLinksJobCount,
	decideHold,
	selectHeldLinksToRestore,
	selectRemovalPage,
	heldLinkExpiresAt,
	isHeldLinkLive,
} from "./saved-links-job";

const READER = UserIdSchema.parse("reader-1");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");

function emailLink(
	overrides: Partial<NewsletterLinkRow> = {},
): NewsletterLinkRow {
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
		assert.deepEqual(
			decideHold({
				row: emailLink(),
				userId: READER,
				cutoff: CUTOFF,
				senders: { kind: "all" },
			}),
			{
				kind: "hold",
			},
		);
	});

	it("does not select a row that is not a newsletter link", () => {
		const row = emailLink({ provenance: { kind: "web" } });
		assert.deepEqual(
			decideHold({
				row,
				userId: READER,
				cutoff: CUTOFF,
				senders: { kind: "all" },
			}),
			{
				kind: "not-selected",
			},
		);
	});

	it("does not select a newsletter link from a sender the reader did not choose, even one it would skip", () => {
		const row = emailLink({ status: "read" });
		const senders = {
			kind: "chosen" as const,
			senderEmails: ["other@news.com"],
		};
		assert.deepEqual(
			decideHold({ row, userId: READER, cutoff: CUTOFF, senders }),
			{ kind: "not-selected" },
		);
	});

	it("holds a newsletter link from a chosen sender", () => {
		const senders = {
			kind: "chosen" as const,
			senderEmails: ["dan@tldr.tech"],
		};
		assert.deepEqual(
			decideHold({ row: emailLink(), userId: READER, cutoff: CUTOFF, senders }),
			{ kind: "hold" },
		);
	});

	it("skips a read link with the classifier's reason", () => {
		const row = emailLink({ status: "read" });
		assert.deepEqual(
			decideHold({
				row,
				userId: READER,
				cutoff: CUTOFF,
				senders: { kind: "all" },
			}),
			{
				kind: "skipped",
				reason: "read",
			},
		);
	});
});

describe("held link expiry", () => {
	const removedAt = new Date("2026-11-20T10:00:00.000Z");

	it("expires 30 days after removal", () => {
		assert.equal(
			heldLinkExpiresAt(removedAt).toISOString(),
			"2026-12-20T10:00:00.000Z",
		);
	});

	it("is live before its expiry and not at it", () => {
		const expiresAt = heldLinkExpiresAt(removedAt);
		assert.equal(
			isHeldLinkLive({
				link: { expiresAt },
				now: new Date(expiresAt.getTime() - 1),
			}),
			true,
		);
		assert.equal(
			isHeldLinkLive({ link: { expiresAt }, now: expiresAt }),
			false,
		);
	});
});

describe("SavedLinksJobCountsSchema", () => {
	it("takes counts by code and refuses an unknown code", () => {
		assert.deepEqual(SavedLinksJobCountsSchema.parse({ held: 3, read: 1 }), {
			held: 3,
			read: 1,
		});
		assert.equal(
			SavedLinksJobCountsSchema.safeParse({ other: 1 }).success,
			false,
		);
	});
});

describe("selectRemovalPage", () => {
	const base = {
		userId: READER,
		highlighted: new Set<string>(),
		openedInReadlists: new Set<string>(),
		cutoff: CUTOFF,
	};

	it("selects held candidates and counts each skip kind once per row", () => {
		const page = selectRemovalPage({
			...base,
			highlighted: new Set(["h.com/a"]),
			openedInReadlists: new Set(["o.com/a"]),
			senders: { kind: "all" },
			counts: { held: 4 },
			candidates: [
				{ kind: "row", row: emailLink({ storedKey: "keep.com/a" }) },
				{
					kind: "row",
					row: emailLink({ storedKey: "r.com/a", status: "read" }),
				},
				{ kind: "row", row: emailLink({ storedKey: "o.com/a" }) },
				{ kind: "row", row: emailLink({ storedKey: "h.com/a" }) },
				{
					kind: "row",
					row: emailLink({
						storedKey: "c.com/a",
						savedAt: new Date("2026-12-02T00:00:00.000Z"),
					}),
				},
				{
					kind: "row",
					row: emailLink({
						storedKey: "web.com/a",
						provenance: { kind: "web" },
					}),
				},
				{ kind: "unreadable" },
			],
		});
		assert.deepEqual(page, {
			selected: ["keep.com/a"],
			counts: {
				held: 4,
				read: 1,
				opened: 1,
				highlighted: 1,
				changed: 1,
				unreadable: 1,
			},
		});
	});

	it("neither selects nor counts a link from a sender the reader did not choose", () => {
		const page = selectRemovalPage({
			...base,
			senders: { kind: "chosen", senderEmails: ["dan@tldr.tech"] },
			counts: {},
			candidates: [
				{ kind: "row", row: emailLink({ storedKey: "a.com/1" }) },
				{
					kind: "row",
					row: emailLink({
						storedKey: "b.com/1",
						provenance: { kind: "email", senderEmail: "x@y.com" },
					}),
				},
				{
					kind: "row",
					row: emailLink({
						storedKey: "b.com/2",
						status: "read",
						provenance: { kind: "email", senderEmail: "x@y.com" },
					}),
				},
			],
		});
		assert.deepEqual(page, { selected: ["a.com/1"], counts: {} });
	});
});

describe("addSavedLinksJobCount", () => {
	it("adds to an absent and to a present count", () => {
		assert.deepEqual(
			addSavedLinksJobCount({ counts: { held: 2 }, code: "held", by: 3 }),
			{ held: 5 },
		);
		assert.deepEqual(
			addSavedLinksJobCount({ counts: {}, code: "restored", by: 1 }),
			{ restored: 1 },
		);
	});
});

describe("selectHeldLinksToRestore", () => {
	const requestedAt = new Date("2026-12-10T00:00:00.000Z");
	const now = new Date("2026-12-11T00:00:00.000Z");
	function held(overrides: Partial<HeldLink>): HeldLink {
		const removedAt =
			overrides.removedAt ?? new Date("2026-12-05T00:00:00.000Z");
		return {
			heldKey: "held-1",
			storedKey: "a.com/1",
			jobId: SavedLinksJobIdSchema.parse("job-1"),
			removedAt,
			expiresAt: heldLinkExpiresAt(removedAt),
			senderEmail: "dan@tldr.tech",
			...overrides,
		};
	}
	it("keeps the earliest-removed copy of a URL held more than once", () => {
		const first = held({
			heldKey: "h1",
			removedAt: new Date("2026-12-02T00:00:00.000Z"),
		});
		const later = held({
			heldKey: "h2",
			removedAt: new Date("2026-12-04T00:00:00.000Z"),
		});
		const earlier = held({
			heldKey: "h0",
			removedAt: new Date("2026-12-01T00:00:00.000Z"),
		});
		assert.deepEqual(
			selectHeldLinksToRestore({
				links: [first, later, earlier],
				requestedAt,
				senders: { kind: "all" },
				now,
			}).map((link) => link.heldKey),
			["h0"],
		);
	});

	it("leaves links removed after the request, expired, or from an unchosen sender", () => {
		const links = [
			held({
				heldKey: "after",
				storedKey: "b.com/1",
				removedAt: new Date("2026-12-10T00:00:01.000Z"),
			}),
			held({ heldKey: "expired", storedKey: "c.com/1", expiresAt: now }),
			held({ heldKey: "other", storedKey: "d.com/1", senderEmail: "x@y.com" }),
			held({ heldKey: "chosen", storedKey: "e.com/1" }),
		];
		assert.deepEqual(
			selectHeldLinksToRestore({
				links,
				requestedAt,
				senders: { kind: "chosen", senderEmails: ["dan@tldr.tech"] },
				now,
			}).map((link) => link.heldKey),
			["chosen"],
		);
	});
});
