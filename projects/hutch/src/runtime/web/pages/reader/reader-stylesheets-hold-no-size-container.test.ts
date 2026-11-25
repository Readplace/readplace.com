import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_STYLES } from "./reader.styles";

const SKELETON_STYLES = readFileSync(
	join(__dirname, "..", "readlist", "reader-skeleton", "reader-skeleton.styles.css"),
	"utf-8",
);

const OUT_OF_FLOW_SELECTORS = [".confirm-popover__surface"];

const SIZE_CONTAINER = /(?:container-type\s*:\s*(?:inline-size|size)\b|container\s*:[^;}]*\/\s*(?:inline-size|size)\b)/;

function sizeContainerRules(css: string): string[] {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g);
	return [...rules]
		.filter(([, , declarations]) => SIZE_CONTAINER.test(declarations))
		.map(([, selector]) => selector.trim());
}

describe("the reader's stylesheets", () => {
	it("hold no in-flow size container, because the stylesheet is inserted again with <main> on every highlight, note and tag action and WebKit lays out a new size container collapsed for one pass, which jumps the reader to the top; a popover that is hidden until it opens in the top layer is out of flow and exempt", () => {
		const offending = sizeContainerRules(`${READER_STYLES}\n${SKELETON_STYLES}`).filter(
			(selector) => !OUT_OF_FLOW_SELECTORS.includes(selector),
		);

		expect(offending).toEqual([]);
	});

	it("still recognise the out-of-flow popover as a size container, so the exemption is not dead", () => {
		expect(sizeContainerRules(READER_STYLES)).toContain(".confirm-popover__surface");
	});
});
