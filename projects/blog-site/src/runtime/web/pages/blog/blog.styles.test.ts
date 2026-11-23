import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { BLOG_STYLES } from "./blog.styles";

function ringDeclarationsOf(selector: string): string[] {
	const { document, CSSStyleRule } = new JSDOM(`<style>${BLOG_STYLES}</style>`).window;
	const rule = Array.from(document.styleSheets[0].cssRules).find(
		(candidate): candidate is CSSStyleRule => candidate instanceof CSSStyleRule && candidate.selectorText === selector,
	);
	assert(rule, `no top-level ${selector} rule in the blog stylesheet`);
	return ["border-color", "border"].map((property) => rule.style.getPropertyValue(property)).filter(Boolean);
}

describe("the budget figure's stops", () => {
	it("ring an unselected stop in --foreground, the brand's off-radio ring, because a --border ring is 1.26:1 on the white post card and a --muted-foreground edge on the stop's --muted fill is the brand's disabled look", () => {
		expect(ringDeclarationsOf(".rpf-budget__stop")).toEqual([expect.stringMatching(/var\(--foreground\)$/)]);
	});
});
