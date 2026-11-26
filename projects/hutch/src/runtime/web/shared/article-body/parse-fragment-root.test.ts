import assert from "node:assert/strict";
import { parseFragmentRoot } from "./parse-fragment-root";

describe("parseFragmentRoot", () => {
	it("returns a root holding the fragment's nodes", () => {
		const root = parseFragmentRoot("<p>One</p><p>Two <a href=\"/x\">link</a></p>");

		assert.equal(root.innerHTML, "<p>One</p><p>Two <a href=\"/x\">link</a></p>");
		assert.equal(root.querySelectorAll("p").length, 2);
	});

	it("parses a bare text fragment", () => {
		assert.equal(parseFragmentRoot("plain &amp; text").textContent, "plain & text");
	});

	it("gives the root a document that can create elements", () => {
		const root = parseFragmentRoot("<p>One</p>");

		root.append(root.ownerDocument.createElement("hr"));

		assert.equal(root.innerHTML, "<p>One</p><hr>");
	});
});
