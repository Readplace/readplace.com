import { tldrCallout } from "./tldr-callout";

describe("tldrCallout", () => {
	it("quotes a single line under the summary callout opener", () => {
		expect(tldrCallout("One line.")).toBe("> [!summary] Summary (TL;DR)\n> One line.");
	});

	it("keeps the blank line between paragraphs inside the quote", () => {
		expect(tldrCallout("First.\n\nSecond.")).toBe(
			"> [!summary] Summary (TL;DR)\n> First.\n>\n> Second.",
		);
	});
});
