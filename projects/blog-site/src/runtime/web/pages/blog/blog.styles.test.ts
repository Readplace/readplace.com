import { BLOG_STYLES } from "./blog.styles";

function declarationsOf(selector: string): string {
	const start = BLOG_STYLES.indexOf(`\n${selector} {`);
	expect(start).not.toBe(-1);
	return BLOG_STYLES.slice(start, BLOG_STYLES.indexOf("}", start));
}

describe("the budget figure's stops", () => {
	it("ring an unselected stop in --foreground, the brand's off-radio ring, because a --border ring is 1.26:1 on the white post card and a --muted-foreground edge on the stop's --muted fill is the brand's disabled look", () => {
		expect(declarationsOf(".rpf-budget__stop")).toMatch(/border:\s*2px solid var\(--foreground\)/);
	});
});
