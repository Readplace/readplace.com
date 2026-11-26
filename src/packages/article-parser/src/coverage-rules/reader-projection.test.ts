import { projectReaderHtml } from "./reader-projection";

describe("projectReaderHtml", () => {
	it("parses what the reader's sanitiser keeps under a root element and carries the media map", () => {
		const media = new Map([["https://origin.example/a.png", "https://cdn.example/a.png"]]);
		const projection = projectReaderHtml({ html: "<p>Kept</p><script>dropped()</script>", media });
		expect(projection.document.getElementById("root")?.innerHTML).toBe("<p>Kept</p>");
		expect(projection.media).toBe(media);
	});
});
