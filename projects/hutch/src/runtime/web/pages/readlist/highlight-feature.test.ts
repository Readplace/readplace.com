import { HighlightIdSchema } from "@packages/domain/article";
import {
	HIGHLIGHT_FEATURE,
	highlightFeatureEnabled,
	highlightFeatureParams,
	highlightPathsFor,
	withHighlightFeature,
} from "./highlight-feature";

describe("highlightFeatureEnabled", () => {
	it("is on when the query names the highlight feature", () => {
		expect(highlightFeatureEnabled({ feature: HIGHLIGHT_FEATURE })).toBe(true);
	});

	it("is off without the feature param", () => {
		expect(highlightFeatureEnabled({})).toBe(false);
	});

	it("is off for another feature", () => {
		expect(highlightFeatureEnabled({ feature: "pref" })).toBe(false);
	});
});

describe("highlightFeatureParams", () => {
	it("carries the feature param when enabled", () => {
		expect(highlightFeatureParams(true)).toEqual([["feature", "highlight"]]);
	});

	it("carries nothing when disabled", () => {
		expect(highlightFeatureParams(false)).toEqual([]);
	});
});

describe("withHighlightFeature", () => {
	it("appends the feature after the extra params", () => {
		expect(
			withHighlightFeature({
				path: "/queue/a/view",
				enabled: true,
				extra: [["readlist", "work"]],
			}),
		).toBe("/queue/a/view?readlist=work&feature=highlight");
	});

	it("returns the bare path when disabled and without extras", () => {
		expect(
			withHighlightFeature({ path: "/queue/a/view", enabled: false }),
		).toBe("/queue/a/view");
	});

	it("keeps the extras when disabled", () => {
		expect(
			withHighlightFeature({
				path: "/queue/a/view",
				enabled: false,
				extra: [["readlist", "work"]],
			}),
		).toBe("/queue/a/view?readlist=work");
	});
});

describe("highlightPathsFor", () => {
	const highlightId = HighlightIdSchema.parse(
		"0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e",
	);

	it("carries the requested section on the view, create and delete paths", () => {
		const paths = highlightPathsFor({
			articleId: "a",
			query: { section: "2" },
		});

		expect(paths.viewPath).toBe("/queue/a/view?section=2&feature=highlight");
		expect(paths.createUrl).toContain(
			"/queue/a/highlights?section=2&feature=highlight",
		);
		expect(paths.deleteUrlFor(highlightId)).toContain(
			`/queue/a/highlights/${highlightId}/delete?section=2&feature=highlight`,
		);
	});

	it("carries no section when none is requested", () => {
		const paths = highlightPathsFor({ articleId: "a", query: {} });

		expect(paths.viewPath).toBe("/queue/a/view?feature=highlight");
		expect(paths.createUrl).not.toContain("section=");
		expect(paths.deleteUrlFor(highlightId)).not.toContain("section=");
	});

	it("tags the delete path as the rail's Delete", () => {
		const paths = highlightPathsFor({ articleId: "a", query: {} });

		const url = new URL(
			paths.deleteUrlFor(highlightId),
			"https://readplace.com",
		);
		expect(url.pathname).toBe(`/queue/a/highlights/${highlightId}/delete`);
		expect(url.searchParams.get("feature")).toBe("highlight");
		expect(url.searchParams.get("utm_source")).toBe("highlights-rail");
		expect(url.searchParams.get("utm_content")).toBe("delete-highlight");
	});

	it("tags the note create path as the toolbar's Save note and the note path as the rail's Edit note", () => {
		const paths = highlightPathsFor({
			articleId: "a",
			query: { section: "2" },
		});

		const create = new URL(paths.noteCreateUrl, "https://readplace.com");
		expect(create.pathname).toBe("/queue/a/highlights");
		expect(create.searchParams.get("section")).toBe("2");
		expect(create.searchParams.get("feature")).toBe("highlight");
		expect(create.searchParams.get("utm_source")).toBe("highlight-toolbar");
		expect(create.searchParams.get("utm_content")).toBe("save-note");
		const note = new URL(
			paths.noteUrlFor(highlightId),
			"https://readplace.com",
		);
		expect(note.pathname).toBe(`/queue/a/highlights/${highlightId}/note`);
		expect(note.searchParams.get("section")).toBe("2");
		expect(note.searchParams.get("feature")).toBe("highlight");
		expect(note.searchParams.get("utm_source")).toBe("highlights-rail");
		expect(note.searchParams.get("utm_content")).toBe("edit-note");
	});
});
