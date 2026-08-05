import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { computeInboxExcludedRowEtag } from "./inbox-excluded-link.etag";

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "skipped",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: "llm-ad",
		...overrides,
	};
}

describe("computeInboxExcludedRowEtag", () => {
	it("is a weak tag carrying the ordinal", () => {
		expect(computeInboxExcludedRowEtag({ link: link(), saveState: undefined })).toMatch(
			/^W\/"0000:[0-9a-f]{16}"$/,
		);
	});

	it("is stable for an unchanged row", () => {
		expect(computeInboxExcludedRowEtag({ link: link(), saveState: undefined })).toBe(
			computeInboxExcludedRowEtag({ link: link(), saveState: undefined }),
		);
	});

	it("changes when the save lands, so a settled row cannot answer 304 with its pre-save validator", () => {
		const settling = computeInboxExcludedRowEtag({ link: link(), saveState: undefined });
		const saved = computeInboxExcludedRowEtag({ link: link(), saveState: "saved" });

		expect(settling).not.toBe(saved);
	});

	it("separates a failed save from a row with no recorded save", () => {
		const unsaved = computeInboxExcludedRowEtag({ link: link(), saveState: undefined });
		const failed = computeInboxExcludedRowEtag({ link: link(), saveState: "failed" });

		expect(unsaved).not.toBe(failed);
	});

	it("changes when the reason the row shows changes", () => {
		const advert = computeInboxExcludedRowEtag({ link: link(), saveState: undefined });
		const unlabelled = computeInboxExcludedRowEtag({
			link: link({ skipReason: undefined }),
			saveState: undefined,
		});

		expect(advert).not.toBe(unlabelled);
	});

	it("changes when the link stops being skipped, which the row no longer renders", () => {
		const skipped = computeInboxExcludedRowEtag({ link: link(), saveState: undefined });
		const crawled = computeInboxExcludedRowEtag({
			link: link({ status: "crawled" }),
			saveState: undefined,
		});

		expect(skipped).not.toBe(crawled);
	});
});
