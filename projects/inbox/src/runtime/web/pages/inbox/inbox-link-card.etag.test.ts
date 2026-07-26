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
		...overrides,
	};
}

describe("computeInboxLinkCardEtag", () => {
	it("is a weak tag carrying the ordinal", () => {
		expect(computeInboxLinkCardEtag({ link: link(), saveState: undefined })).toMatch(/^W\/"0000:[0-9a-f]{16}"$/);
	});

	it("changes when the link transitions from pending to crawled", () => {
		const pending = computeInboxLinkCardEtag({ link: link({ status: "pending" }), saveState: undefined });
		const crawled = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }), saveState: undefined });

		expect(pending).not.toBe(crawled);
	});

	it("is stable for an unchanged link", () => {
		expect(computeInboxLinkCardEtag({ link: link(), saveState: undefined })).toBe(computeInboxLinkCardEtag({ link: link(), saveState: undefined }));
	});

	it("ignores stored fields the row no longer renders", () => {
		const withPreview = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }), saveState: undefined });
		const bare = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined });
		expect(withPreview).toBe(bare);

		const failedA = computeInboxLinkCardEtag({ link: link({ status: "failed", failureReason: "crawl-failed" }), saveState: undefined });
		const failedB = computeInboxLinkCardEtag({ link: link({ status: "failed", failureReason: "blocked" }), saveState: undefined });
		expect(failedA).toBe(failedB);
	});

	it("changes when the title changes", () => {
		const t = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined });
		const u = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "U" }), saveState: undefined });
		expect(t).not.toBe(u);
	});

	it("changes when the resolved destination changes", () => {
		const unresolved = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined });
		const resolved = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", resolvedUrl: "https://destination.test/a" }), saveState: undefined });
		expect(unresolved).not.toBe(resolved);
	});

	it("changes when only the save state changes", () => {
		const unsaved = computeInboxLinkCardEtag({ link: link(), saveState: undefined });
		const saved = computeInboxLinkCardEtag({ link: link(), saveState: "saved" });
		expect(unsaved).not.toBe(saved);
	});

	it("separates a failed save from an unsaved link", () => {
		const unsaved = computeInboxLinkCardEtag({ link: link(), saveState: undefined });
		const failed = computeInboxLinkCardEtag({ link: link(), saveState: "failed" });
		expect(unsaved).not.toBe(failed);
	});
});
