import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { computeInboxLinkCardEtag } from "./inbox-link-card.etag";

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		submittedAt: undefined,
		...overrides,
	};
}

describe("computeInboxLinkCardEtag", () => {
	it("is a weak tag carrying the ordinal", () => {
		expect(computeInboxLinkCardEtag(link())).toMatch(/^W\/"0000:[0-9a-f]{16}"$/);
	});

	it("changes when the link transitions from pending to crawled", () => {
		const pending = computeInboxLinkCardEtag(link({ status: "pending" }));
		const crawled = computeInboxLinkCardEtag(
			link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }),
		);

		expect(pending).not.toBe(crawled);
	});

	it("is stable for an unchanged link", () => {
		expect(computeInboxLinkCardEtag(link())).toBe(computeInboxLinkCardEtag(link()));
	});

	it("ignores stored fields the row no longer renders", () => {
		const withPreview = computeInboxLinkCardEtag(
			link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }),
		);
		const bare = computeInboxLinkCardEtag(link({ status: "crawled", title: "T" }));
		expect(withPreview).toBe(bare);

		const failedA = computeInboxLinkCardEtag(link({ status: "failed", failureReason: "crawl-failed" }));
		const failedB = computeInboxLinkCardEtag(link({ status: "failed", failureReason: "blocked" }));
		expect(failedA).toBe(failedB);
	});

	it("changes when the title changes", () => {
		const t = computeInboxLinkCardEtag(link({ status: "crawled", title: "T" }));
		const u = computeInboxLinkCardEtag(link({ status: "crawled", title: "U" }));
		expect(t).not.toBe(u);
	});

	it("changes when the resolved destination changes", () => {
		const unresolved = computeInboxLinkCardEtag(link({ status: "crawled", title: "T" }));
		const resolved = computeInboxLinkCardEtag(
			link({ status: "crawled", title: "T", resolvedUrl: "https://destination.test/a" }),
		);
		expect(unresolved).not.toBe(resolved);
	});

	it("changes once the link is submitted, so a save from another tab invalidates a mid-poll card", () => {
		const unsaved = computeInboxLinkCardEtag(link({ status: "crawled", title: "T" }));
		const saved = computeInboxLinkCardEtag(
			link({ status: "crawled", title: "T", submittedAt: "2026-07-01T00:00:00.000Z" }),
		);
		expect(unsaved).not.toBe(saved);
	});
});
