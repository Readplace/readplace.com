import { parseHTML } from "linkedom";
import { noExtract, noTransform, skipCrawl } from "./index";

describe("site-rules shared opt-out hooks", () => {
	it("skipCrawl declines so the normal fetch cascade runs", async () => {
		expect(await skipCrawl({ url: "https://example.com/post" })).toEqual({ kind: "skip" });
	});

	it("noExtract leaves the fetched document for the default parser", () => {
		expect(noExtract({ html: "<article><p>body</p></article>" })).toBeUndefined();
	});

	it("noTransform makes no change to the document", () => {
		const { document } = parseHTML("<article><p>body</p></article>");
		const before = document.body.innerHTML;
		expect(noTransform({ document })).toBeUndefined();
		expect(document.body.innerHTML).toBe(before);
	});
});
