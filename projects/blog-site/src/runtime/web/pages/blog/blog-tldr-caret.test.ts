import { iconSvg } from "@packages/ui-icons";
import { withTldrCaret } from "./blog-tldr-caret";

describe("withTldrCaret", () => {
	it("draws the chevron at the end of the TL;DR summary label", () => {
		const html =
			'<details class="blog-tldr"><summary class="blog-tldr__toggle">Summary (TL;DR)</summary><div class="blog-tldr__body">Short.</div></details>';
		expect(withTldrCaret(html)).toBe(
			`<details class="blog-tldr"><summary class="blog-tldr__toggle">Summary (TL;DR)<span class="blog-tldr__caret">${iconSvg("chevron-down")}</span></summary><div class="blog-tldr__body">Short.</div></details>`,
		);
	});
});
