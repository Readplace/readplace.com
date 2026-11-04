import { UserIdSchema } from "../user/user.schema";
import { ANONYMOUS_VIEWER, viewerFor } from "./private-item-access";
import { shownSummary } from "./shown-summary";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const READY = { status: "ready", summary: "Chapter summary" } as const;

describe("shownSummary", () => {
	it("shows the stored summary of an article page", () => {
		expect(
			shownSummary({
				url: "https://example.com/post", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined,
				summary: { status: "ready", summary: "A summary", excerpt: "An excerpt" },
			}),
		).toEqual({ status: "ready", summary: "A summary", excerpt: "An excerpt" });
	});

	it("shows a pending summary of an article page", () => {
		expect(shownSummary({ url: "https://example.com/post", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined, summary: { status: "pending" } })).toEqual({
			status: "pending",
		});
	});

	it("shows nothing for an article page without a stored summary", () => {
		expect(shownSummary({ url: "https://example.com/post", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined, summary: undefined })).toBeUndefined();
	});

	it("skips the summary of a webmail page, even a ready one", () => {
		expect(
			shownSummary({
				url: "https://mail.google.com/mail/u/2/", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined,
				summary: { status: "ready", summary: "Private inbox summary", excerpt: "Private excerpt" },
			}),
		).toEqual({ status: "skipped" });
	});

	it("skips the summary of a webmail page that has none stored", () => {
		expect(shownSummary({ url: "https://mail.google.com/mail/u/2/", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined, summary: undefined })).toEqual({
			status: "skipped",
		});
	});

	it("shows the summary of a private upload to its owner", () => {
		expect(shownSummary({ url: PRIVATE_URL, summary: READY, viewer: viewerFor(OWNER), ownerUserId: OWNER })).toEqual(READY);
	});

	it("skips the summary of a private upload for a signed-out viewer, even a ready one", () => {
		expect(shownSummary({ url: PRIVATE_URL, summary: READY, viewer: ANONYMOUS_VIEWER, ownerUserId: OWNER })).toEqual({
			status: "skipped",
		});
	});

	it("skips the summary of a private upload for another reader", () => {
		expect(
			shownSummary({
				url: PRIVATE_URL,
				summary: READY,
				viewer: viewerFor(UserIdSchema.parse("other-reader")),
				ownerUserId: OWNER,
			}),
		).toEqual({ status: "skipped" });
	});
});
