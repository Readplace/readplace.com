import { buildMarkdownFrontmatter } from "./markdown-frontmatter";

describe("buildMarkdownFrontmatter", () => {
	it("renders title as h1, description as a paragraph, and canonical URL", () => {
		const result = buildMarkdownFrontmatter({
			title: "Hello world",
			description: "An article about hellos.",
			canonicalUrl: "https://readplace.com/hello",
		});

		expect(result).toBe(
			[
				"# Hello world",
				"",
				"An article about hellos.",
				"",
				"Canonical: https://readplace.com/hello",
			].join("\n"),
		);
	});

	it("includes author and formattedDate when provided", () => {
		const result = buildMarkdownFrontmatter(
			{
				title: "Post title",
				description: "Post description.",
				canonicalUrl: "https://readplace.com/blog/post",
				author: "Fayner Brack",
			},
			{ formattedDate: "1 May 2026" },
		);

		expect(result).toContain("Author: Fayner Brack");
		expect(result).toContain("Date: 1 May 2026");
		expect(result).toContain("Canonical: https://readplace.com/blog/post");
	});

	it("omits the metadata block entirely when no author, date, or canonical URL", () => {
		const result = buildMarkdownFrontmatter({
			title: "Stub",
			description: "Stub description.",
			canonicalUrl: "",
		});

		expect(result).toBe("# Stub\n\nStub description.");
	});
});
