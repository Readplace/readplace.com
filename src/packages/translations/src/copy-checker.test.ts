import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectTemplates, findCopyViolations, helperKeyOf, pathKeyOf } from "./copy-checker";

const MESSAGES: Readonly<Record<string, string>> = {
	"page.heading": "Your reading list",
	"page.greeting": "Hello, {name}",
};

function check(source: string, keyOf = helperKeyOf) {
	return findCopyViolations({
		templates: [{ file: "page.template.html", source }],
		findMessage: (key) => MESSAGES[key],
		keyOf,
		exemptTokens: ["Readplace"],
	}).map((violation) => violation.text);
}

describe("findCopyViolations", () => {
	it("passes a template whose copy all comes from {{t}}", () => {
		assert.deepEqual(
			check('<h1 title="{{t "page.heading"}}">{{t "page.greeting" name=user.name}}</h1>{{#if x}}<p>{{t "page.heading"}}</p>{{/if}}'),
			[],
		);
	});

	it("reports a literal text node with its file, joined across entities", () => {
		assert.deepEqual(
			findCopyViolations({
				templates: [{ file: "a.template.html", source: "<p>Don&rsquo;t   {{name}} go</p>" }],
				findMessage: () => undefined,
				keyOf: helperKeyOf,
				exemptTokens: [],
			}),
			[{ file: "a.template.html", text: "Don’t {{…}} go" }],
		);
	});

	it("reports literal copy inside block branches", () => {
		assert.deepEqual(check("{{#if a}}<p>Shown</p>{{else}}<p>Hidden</p>{{/if}}"), ["Shown", "Hidden"]);
	});

	it("ignores scripts, styles, punctuation, entities, mustaches and exempt tokens", () => {
		assert.deepEqual(
			check("<style>.a { color: red }</style><script>const label = 'x';</script><p>&copy; {{year}} · 42 —</p><b>Readplace</b>"),
			[],
		);
	});

	it("reports copy in the attributes a reader or assistive tech meets", () => {
		assert.deepEqual(
			check(
				'<img alt="Cover" src="/a.png"><button aria-label="Close" aria-description="Closes it" title="Tip"></button><input placeholder="Search" name="q" value="v">',
			),
			['alt="Cover"', 'aria-label="Close"', 'aria-description="Closes it"', 'title="Tip"', 'placeholder="Search"'],
		);
	});

	it("reports the content of description and title meta tags only", () => {
		assert.deepEqual(
			check(
				'<meta name="description" content="About us"><meta property="og:title" content="Title"><meta name="viewport" content="width=device-width"><meta charset="utf-8"><meta property="og:description" content="{{description}}">',
			),
			['content="About us"', 'content="Title"'],
		);
	});

	it("reports a {{t}} key that is not a string literal, is unknown, or gets the wrong params", () => {
		assert.deepEqual(check("{{t key}}{{t}}"), ["{{t}} needs a string-literal key", "{{t}} needs a string-literal key"]);
		assert.deepEqual(check('{{t "page.missing"}}'), ['{{t}} names the unknown message "page.missing"']);
		assert.deepEqual(check('{{t "page.greeting"}}'), ['{{t "page.greeting"}} takes {name}, got {}']);
		assert.deepEqual(check('{{t "page.heading" extra=1}}'), ['{{t "page.heading"}} takes {}, got {extra}']);
	});

	it("checks {{t}} used as a subexpression", () => {
		assert.deepEqual(check('{{#if (t "page.missing")}}{{/if}}{{helper (other)}}'), ['{{t}} names the unknown message "page.missing"']);
	});

	it("reads keys written as t.<key> paths for templates filled outside Handlebars", () => {
		assert.deepEqual(check("<p>{{t.page.heading}}</p><p>{{t.page.missing}}</p><p>{{other}}</p>", pathKeyOf), [
			'{{t}} names the unknown message "page.missing"',
		]);
		assert.deepEqual(check('<p>{{"literal"}}</p>', pathKeyOf), []);
		assert.deepEqual(check('<p>{{"literal"}}</p>'), []);
	});
});

describe("collectTemplates", () => {
	it("reads .template.html files and every string a .template.js module exports", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "copy-checker-"));
		mkdirSync(path.join(root, "pages", "nested"), { recursive: true });
		writeFileSync(path.join(root, "pages", "a.template.html"), "<p>A</p>");
		writeFileSync(path.join(root, "pages", "nested", "b.template.js"), 'exports.B_TEMPLATE = "<p>B</p>"; exports.count = 2;');
		writeFileSync(path.join(root, "pages", "c.ts"), "export {};");
		writeFileSync(path.join(root, "outside.template.html"), "<p>Outside</p>");
		assert.deepEqual(await collectTemplates({ root, directories: ["pages"] }), [
			{ file: path.join("pages", "a.template.html"), source: "<p>A</p>" },
			{ file: path.join("pages", "nested", "b.template.js#B_TEMPLATE"), source: "<p>B</p>" },
		]);
	});
});
