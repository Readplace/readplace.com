import { UserIdSchema } from "../user/user.schema";
import { SUMMARY_WITHHELD_REASON, generatedContentAccessFor } from "./generated-content";
import { ANONYMOUS_VIEWER, type Viewer, viewerFor } from "./private-item-access";
import { type GeneratedSummary, shownSummary } from "./shown-summary";

const WITHHELD = generatedContentAccessFor({ viewerCountry: "CN", storefront: undefined });
const OWNER = UserIdSchema.parse("owner-user");
const SENTINEL = "generated-text-sentinel-8d4f";

const STORED_SUMMARIES: ReadonlyArray<{ name: string; summary: GeneratedSummary | undefined }> = [
	{ name: "no stored summary", summary: undefined },
	{ name: "a pending summary", summary: { status: "pending" } },
	{ name: "a ready summary", summary: { status: "ready", summary: SENTINEL, excerpt: SENTINEL } },
	{ name: "a failed summary", summary: { status: "failed", reason: SENTINEL } },
	{ name: "a skipped summary", summary: { status: "skipped", reason: SENTINEL } },
];

const VIEWERS: ReadonlyArray<{ name: string; viewer: Viewer }> = [
	{ name: "a signed-out viewer", viewer: ANONYMOUS_VIEWER },
	{ name: "the owner", viewer: viewerFor(OWNER) },
];

describe("a summary withheld from a viewer in mainland China", () => {
	describe.each(STORED_SUMMARIES)("with $name", ({ summary }) => {
		it.each(VIEWERS)("gives $name the withheld skip and none of the stored text", ({ viewer }) => {
			const shown = shownSummary({
				url: "https://example.com/post",
				summary,
				viewer,
				ownerUserId: OWNER,
				generatedContent: WITHHELD,
			});

			expect(shown).toEqual({ status: "skipped", reason: SUMMARY_WITHHELD_REASON });
			expect(JSON.stringify(shown)).not.toContain(SENTINEL);
		});
	});
});
