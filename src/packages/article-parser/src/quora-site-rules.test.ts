import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { quoraSiteRules } from "./quora-site-rules";

const SHARED_ANSWER = "https://www.quora.com/How-often-is-a-sample-part-designed/answer/Sample-Person";

function remainingMetas(headHtml: string): readonly string[] {
	const { document } = parseHTML(`<!DOCTYPE html><html><head>${headHtml}</head><body></body></html>`);
	quoraSiteRules.transform({ document });
	return Array.from(document.querySelectorAll("meta")).map((meta) => String(meta.getAttribute("content")));
}

describe("quoraSiteRules.matches", () => {
	it.each(["quora.com", "www.quora.com", "sample-space.quora.com"])("matches %s", (hostname) => {
		assert.equal(quoraSiteRules.matches({ url: `https://${hostname}/post`, hostname }), true);
	});

	it("leaves another host alone", () => {
		assert.equal(quoraSiteRules.matches({ url: "https://notquora.com/post", hostname: "notquora.com" }), false);
	});
});

describe("quoraSiteRules.transform", () => {
	it("removes the URL-valued title and description metas and keeps real-text ones on the same page", () => {
		const remaining = remainingMetas(
			`<meta property="og:title" content="${SHARED_ANSWER}">` +
				`<meta name="twitter:title" content="${SHARED_ANSWER}">` +
				`<meta property="og:description" content="Real description text">` +
				`<meta name="twitter:description" content="${SHARED_ANSWER}">` +
				`<meta property="og:url" content="${SHARED_ANSWER}">`,
		);

		assert.deepEqual(remaining, ["Real description text", SHARED_ANSWER]);
	});

	it("tolerates the trailing space Quora leaves on the value", () => {
		assert.deepEqual(remainingMetas(`<meta property="og:title" content="${SHARED_ANSWER} ">`), []);
	});

	it("keeps a title that merely starts with a URL", () => {
		const title = "https://example.com/ is the page this answer is about";

		assert.deepEqual(remainingMetas(`<meta property="og:title" content="${title}">`), [title]);
	});
});
