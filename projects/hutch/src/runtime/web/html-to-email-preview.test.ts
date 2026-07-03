import { htmlToEmailPreview } from "./html-to-email-preview";

describe("htmlToEmailPreview", () => {
	it("returns each block paragraph as collapsed plain text", () => {
		const preview = htmlToEmailPreview("<p>First   paragraph.</p><p>Second\nparagraph.</p>");

		expect(preview).toEqual(["First paragraph.", "Second paragraph."]);
	});

	it("caps the number of paragraphs to maxParagraphs", () => {
		const html = "<p>One</p><p>Two</p><p>Three</p><p>Four</p>";

		expect(htmlToEmailPreview(html, { maxParagraphs: 2 })).toEqual(["One", "Two"]);
	});

	it("truncates on the word budget and appends an ellipsis to the overflowing paragraph", () => {
		const preview = htmlToEmailPreview("<p>alpha beta gamma delta epsilon</p>", { maxWords: 3 });

		expect(preview).toEqual(["alpha beta gamma…"]);
	});

	it("stops before a paragraph once the word budget is exhausted", () => {
		const preview = htmlToEmailPreview("<p>alpha beta</p><p>gamma delta</p>", { maxWords: 2 });

		expect(preview).toEqual(["alpha beta"]);
	});

	it("strips script and style content instead of previewing it", () => {
		const preview = htmlToEmailPreview(
			"<style>p{color:red}</style><script>alert(1)</script><p>Real body.</p>",
		);

		expect(preview).toEqual(["Real body."]);
	});

	it("skips empty blocks and returns an empty array for text-free input", () => {
		expect(htmlToEmailPreview("<p>  </p><p></p>")).toEqual([]);
		expect(htmlToEmailPreview("")).toEqual([]);
	});

	it("reads headings and list items as paragraphs", () => {
		const preview = htmlToEmailPreview("<h1>Title</h1><ul><li>Point one</li></ul>");

		expect(preview).toEqual(["Title", "Point one"]);
	});
});
