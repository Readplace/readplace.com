import {
	actionLabel,
	actionVariant,
	humanize,
	isUserControl,
	isUserControlLink,
	linkLabel,
	linkPresentation,
} from "./action-affordance";

describe("humanize", () => {
	it("title-cases a single word", () => {
		expect(humanize("delete")).toBe("Delete");
	});

	it("splits a hyphenated name into title-cased words", () => {
		expect(humanize("mark-read")).toBe("Mark Read");
	});

	it("splits an underscored name into title-cased words", () => {
		expect(humanize("archive_now")).toBe("Archive Now");
	});

	it("collapses repeated and trailing separators without emitting blank words", () => {
		expect(humanize("save--link-")).toBe("Save Link");
	});
});

describe("actionVariant", () => {
	it("maps the read-state action to the row toggle", () => {
		expect(actionVariant("update-status")).toBe("toggle");
	});

	it("falls back to the default variant for an unknown name", () => {
		expect(actionVariant("mark-read")).toBe("default");
	});
});

describe("actionLabel", () => {
	it("prefers the server-authored title when present", () => {
		expect(actionLabel({ name: "delete", title: "Remove from list" })).toBe(
			"Remove from list",
		);
	});

	it("falls back to a humanized name when no title is advertised", () => {
		expect(actionLabel({ name: "mark-read" })).toBe("Mark Read");
	});
});

describe("linkPresentation", () => {
	it("maps the read rel to the row anchor", () => {
		expect(linkPresentation("read")).toBe("row-anchor");
	});

	it("maps the collection rel to the popup's own list surface", () => {
		expect(linkPresentation("collection")).toBe("list-view");
	});

	it("falls back to a standalone control for an unknown semantic rel", () => {
		expect(linkPresentation("summary")).toBe("control");
	});
});

describe("linkLabel", () => {
	it("prefers the server-authored title when present", () => {
		expect(
			linkLabel({ rel: "summary", title: "TL;DR", href: "https://x/summary" }),
		).toBe("TL;DR");
	});

	it("falls back to a humanized rel when no title is advertised", () => {
		expect(linkLabel({ rel: "summary", href: "https://x/summary" })).toBe(
			"Summary",
		);
	});
});

describe("isUserControl", () => {
	it("renders a recognised action even when the server gave it no title", () => {
		expect(isUserControl({ name: "update-status" })).toBe(true);
	});

	it("renders an unrecognised action the server titled", () => {
		expect(isUserControl({ name: "archive", title: "Archive" })).toBe(true);
	});

	it("skips a title-less action it does not recognise, which is a machine capability", () => {
		expect(isUserControl({ name: "remove-from-readlist" })).toBe(false);
	});

	it("does not mistake an inherited object key for a recognised action", () => {
		expect(isUserControl({ name: "constructor" })).toBe(false);
	});
});

describe("isUserControlLink", () => {
	it("renders a recognised link even when the server gave it no title", () => {
		expect(isUserControlLink({ rel: "read", href: "https://x/read" })).toBe(true);
	});

	it("renders an unrecognised link the server titled", () => {
		expect(isUserControlLink({ rel: "summary", title: "TL;DR", href: "https://x/summary" })).toBe(true);
	});

	it("skips a title-less link it does not recognise", () => {
		expect(isUserControlLink({ rel: "summary", href: "https://x/summary" })).toBe(false);
	});
});
