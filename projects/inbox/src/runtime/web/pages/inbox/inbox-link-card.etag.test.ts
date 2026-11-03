import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { computeInboxLinkCardEtag } from "./inbox-link-card.etag";
import type { InboxLinkCardReadlistFit } from "./inbox-readlist-fit";

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
		anchorText: undefined,
		...overrides,
	};
}

describe("computeInboxLinkCardEtag", () => {
	it("is a weak tag carrying the ordinal", () => {
		expect(computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] })).toMatch(/^W\/"0000:[0-9a-f]{16}"$/);
	});

	it("changes when the link transitions from pending to crawled", () => {
		const pending = computeInboxLinkCardEtag({ link: link({ status: "pending" }), saveState: undefined, fit: [] });
		const crawled = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }), saveState: undefined, fit: [] });

		expect(pending).not.toBe(crawled);
	});

	it("is stable for an unchanged link", () => {
		expect(computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] })).toBe(computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] }));
	});

	it("ignores stored fields the row no longer renders", () => {
		const withPreview = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: "i" }), saveState: undefined, fit: [] });
		const bare = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined, fit: [] });
		expect(withPreview).toBe(bare);

		const failedA = computeInboxLinkCardEtag({ link: link({ status: "failed", failureReason: "crawl-failed" }), saveState: undefined, fit: [] });
		const failedB = computeInboxLinkCardEtag({ link: link({ status: "failed", failureReason: "blocked" }), saveState: undefined, fit: [] });
		expect(failedA).toBe(failedB);
	});

	it("changes when the title changes", () => {
		const t = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined, fit: [] });
		const u = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "U" }), saveState: undefined, fit: [] });
		expect(t).not.toBe(u);
	});

	it("changes when the resolved destination changes", () => {
		const unresolved = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T" }), saveState: undefined, fit: [] });
		const resolved = computeInboxLinkCardEtag({ link: link({ status: "crawled", title: "T", resolvedUrl: "https://destination.test/a" }), saveState: undefined, fit: [] });
		expect(unresolved).not.toBe(resolved);
	});

	it("changes when only the save state changes", () => {
		const unsaved = computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] });
		const saved = computeInboxLinkCardEtag({ link: link(), saveState: "saved", fit: [] });
		expect(unsaved).not.toBe(saved);
	});

	it("separates a failed save from an unsaved link", () => {
		const unsaved = computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] });
		const failed = computeInboxLinkCardEtag({ link: link(), saveState: "failed", fit: [] });
		expect(unsaved).not.toBe(failed);
	});

	describe("per routed readlist", () => {
		const ORDINAL = EmailLinkOrdinalSchema.parse("0000");
		const WORK = ReadlistSlugSchema.parse("work");

		const override = (input: Partial<Pick<ReadlistFitOverride, "readerVerdict" | "createdAt">> = {}): ReadlistFitOverride => ({
			id: ReadlistFitOverrideIdSchema.parse("0000000000000001-e-0000"),
			url: "https://example.com/post",
			anchorText: "Post",
			host: "example.com",
			readerVerdict: input.readerVerdict ?? "keep",
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
			ordinal: ORDINAL,
			createdAt: input.createdAt ?? new Date("2026-10-14T10:00:00.000Z"),
		});

		const readlistFit = (input: {
			decision?: InboxLinkCardReadlistFit["outcome"]["decision"];
			verdict?: "keep" | "drop" | "unsure";
			reason?: string;
			override?: ReadlistFitOverride;
		} = {}): InboxLinkCardReadlistFit => ({
			readlist: WORK,
			label: "Work",
			outcome: {
				readlist: WORK,
				readlistLabel: "Work",
				decision: input.decision ?? "filtered",
				fit: [{ ordinal: ORDINAL, verdict: input.verdict ?? "keep", reason: input.reason ?? "Fits." }],
			},
			override: input.override,
		});

		const etag = (entry: InboxLinkCardReadlistFit) =>
			computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [entry] });

		it("changes when a routed readlist's outcome arrives", () => {
			expect(computeInboxLinkCardEtag({ link: link(), saveState: undefined, fit: [] })).not.toBe(etag(readlistFit()));
		});

		it("changes with the outcome's decision", () => {
			expect(etag(readlistFit())).not.toBe(etag(readlistFit({ decision: "failed" })));
		});

		it("changes with the engine's verdict", () => {
			expect(etag(readlistFit({ verdict: "keep" }))).not.toBe(etag(readlistFit({ verdict: "drop" })));
		});

		it("changes with the engine's reason", () => {
			expect(etag(readlistFit({ reason: "Fits." }))).not.toBe(etag(readlistFit({ reason: "Fits well." })));
		});

		it("separates a card the outcome has no entry for from one it kept", () => {
			const unlisted: InboxLinkCardReadlistFit = { ...readlistFit(), outcome: { ...readlistFit().outcome, fit: [] } };
			expect(etag(unlisted)).not.toBe(etag(readlistFit()));
		});

		it("changes when the reader overrides the call", () => {
			expect(etag(readlistFit())).not.toBe(etag(readlistFit({ override: override() })));
		});

		it("changes with the reader's verdict", () => {
			expect(etag(readlistFit({ override: override({ readerVerdict: "keep" }) }))).not.toBe(
				etag(readlistFit({ override: override({ readerVerdict: "drop" }) })),
			);
		});

		it("changes when the same choice is made again on a later day", () => {
			expect(etag(readlistFit({ override: override({ createdAt: new Date("2026-10-14T10:00:00.000Z") }) }))).not.toBe(
				etag(readlistFit({ override: override({ createdAt: new Date("2026-10-15T10:00:00.000Z") }) })),
			);
		});
	});
});
