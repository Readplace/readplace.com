import { iconSvg } from "@packages/ui-icons";
import {
	actionIcon,
	actionLabel,
	actionVariant,
	humanize,
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
	it("maps the delete action to the danger variant", () => {
		expect(actionVariant("delete")).toBe("danger");
	});

	it("falls back to the default variant for an unknown name", () => {
		expect(actionVariant("mark-read")).toBe("default");
	});
});

describe("actionIcon", () => {
	it("maps the delete action to the shared set's icon markup", () => {
		expect(actionIcon("delete")).toBe(iconSvg("x"));
	});

	it("returns undefined for an action with no bespoke icon", () => {
		expect(actionIcon("mark-read")).toBeUndefined();
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
