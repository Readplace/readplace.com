import { type AnchorState, type Highlight, HighlightIdSchema } from "@packages/domain/article";
import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { highlightsMarkdown } from "./highlights-markdown";

function stateOf(input: {
	id: string;
	exact: string;
	orderKey: number;
	note?: string;
	anchorState?: AnchorState;
}): ReaderHighlightState {
	const highlight: Highlight = {
		highlightId: HighlightIdSchema.parse(input.id),
		highlightOf: "example.com/post",
		exact: input.exact,
		prefix: "",
		suffix: "",
		start: 0,
		end: input.exact.length,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: input.orderKey,
		...(input.note === undefined ? {} : { note: input.note }),
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
	return {
		highlight,
		anchor: { start: 0, end: input.exact.length, anchorState: input.anchorState ?? "anchored" },
	};
}

const FIRST_ID = "0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const SECOND_ID = "1c9a7d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f";

describe("highlightsMarkdown", () => {
	it("is empty without highlights", () => {
		expect(highlightsMarkdown([])).toBe("");
	});

	it("lists highlights in orderKey order whatever the input order", () => {
		const markdown = highlightsMarkdown([
			stateOf({ id: SECOND_ID, exact: "Second passage", orderKey: 20 }),
			stateOf({ id: FIRST_ID, exact: "First passage", orderKey: 10 }),
		]);

		expect(markdown).toBe("\n## Highlights\n\n> First passage\n\n> Second passage\n");
	});

	it("puts a note right after its quote", () => {
		const markdown = highlightsMarkdown([stateOf({ id: FIRST_ID, exact: "A passage", orderKey: 0, note: "My thought" })]);

		expect(markdown).toBe("\n## Highlights\n\n> A passage\n\nMy thought\n");
	});

	it("marks an orphan as not found in the current version", () => {
		const markdown = highlightsMarkdown([
			stateOf({ id: FIRST_ID, exact: "Gone passage", orderKey: 0, anchorState: "orphaned" }),
		]);

		expect(markdown.split("\n")).toContain("> Gone passage (not found in the current version)");
	});

	it("quotes markdown characters and a two-block passage so the text round-trips", () => {
		const markdown = highlightsMarkdown([
			stateOf({ id: FIRST_ID, exact: "Stars *bold* # not a heading [link]\nSecond block", orderKey: 0 }),
		]);

		const quoted = markdown
			.split("\n")
			.filter((line) => line.startsWith(">"))
			.map((line) => line.replace(/^> ?/, "").replace(/\\([*#[\]])/g, "$1"));
		expect(quoted).toEqual(["Stars *bold* # not a heading [link]", "", "Second block"]);
		expect(markdown).toContain("\\*bold\\*");
	});

	it("keeps angle brackets and ampersands in a note literal", () => {
		const markdown = highlightsMarkdown([stateOf({ id: FIRST_ID, exact: "A passage", orderKey: 0, note: "a < b > c & d" })]);

		expect(markdown.endsWith("a < b > c & d\n")).toBe(true);
	});

	it("gives the same string for the same highlights", () => {
		const states = [
			stateOf({ id: FIRST_ID, exact: "First passage", orderKey: 10, note: "n" }),
			stateOf({ id: SECOND_ID, exact: "Second passage", orderKey: 20, anchorState: "orphaned" }),
		];

		expect(highlightsMarkdown(states)).toBe(highlightsMarkdown(states));
	});
});
