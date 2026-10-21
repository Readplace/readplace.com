import { codeSpanOnOneLine } from "./code-span-on-one-line";

describe("codeSpanOnOneLine", () => {
	it("joins the lines of block content with a single space", () => {
		expect(codeSpanOnOneLine("+\n\nconst total = 2;\n\n")).toBe(
			"+ const total = 2;",
		);
	});

	it("drops the line breaks around block content", () => {
		expect(codeSpanOnOneLine("\n\n@@ -7,3 +7,3 @@\n\n")).toBe(
			"@@ -7,3 +7,3 @@",
		);
	});

	it("writes a hard break as a single space", () => {
		expect(codeSpanOnOneLine("npm install  \n--save")).toBe(
			"npm install --save",
		);
	});

	it("leaves content without a line break as it is", () => {
		expect(codeSpanOnOneLine(" a  b ")).toBe(" a  b ");
	});
});
