import assert from "node:assert/strict";
import { resolveZipPath } from "./xml-elements";

describe("resolveZipPath", () => {
	it.each([
		["chapter.xhtml", "OEBPS/text/chapter.xhtml"],
		["./chapter.xhtml", "OEBPS/text/chapter.xhtml"],
		["../images//cover%20art.png", "OEBPS/images/cover art.png"],
	])("resolves %s against the referring file's folder", (href, expected) => {
		assert.equal(resolveZipPath({ from: "OEBPS/text/nav.xhtml", href }), expected);
	});
});
