import { shownSummary } from "./shown-summary";

describe("shownSummary", () => {
	it("shows the stored summary of an article page", () => {
		expect(
			shownSummary({
				url: "https://example.com/post",
				summary: { status: "ready", summary: "A summary", excerpt: "An excerpt" },
			}),
		).toEqual({ status: "ready", summary: "A summary", excerpt: "An excerpt" });
	});

	it("shows a pending summary of an article page", () => {
		expect(shownSummary({ url: "https://example.com/post", summary: { status: "pending" } })).toEqual({
			status: "pending",
		});
	});

	it("shows nothing for an article page without a stored summary", () => {
		expect(shownSummary({ url: "https://example.com/post", summary: undefined })).toBeUndefined();
	});

	it("skips the summary of a webmail page, even a ready one", () => {
		expect(
			shownSummary({
				url: "https://mail.google.com/mail/u/2/",
				summary: { status: "ready", summary: "Private inbox summary", excerpt: "Private excerpt" },
			}),
		).toEqual({ status: "skipped" });
	});

	it("skips the summary of a webmail page that has none stored", () => {
		expect(shownSummary({ url: "https://mail.google.com/mail/u/2/", summary: undefined })).toEqual({
			status: "skipped",
		});
	});
});
