import assert from "node:assert/strict";
import Handlebars from "handlebars";
import { messageHtml, toSingleQuotedJsString } from "./message-html";

describe("messageHtml", () => {
	it("escapes only & < > \" in the message text, so apostrophes and glyphs stay as written", () => {
		assert.equal(messageHtml(`Tom & Jerry's <"show"> — it’s on`, {}).toHTML(), "Tom &amp; Jerry's &lt;&quot;show&quot;&gt; — it’s on");
	});

	it("escapes a param the way {{value}} would", () => {
		assert.equal(messageHtml("Hello, {name}", { name: "<b>'Ada'</b>" }).toHTML(), "Hello, &lt;b&gt;&#x27;Ada&#x27;&lt;/b&gt;");
		assert.equal(messageHtml("{count} left", { count: 3 }).toHTML(), "3 left");
	});

	it("keeps a SafeString param as markup", () => {
		assert.equal(messageHtml("Read {link}", { link: new Handlebars.SafeString("<a href=\"/\">this</a>") }).toHTML(), 'Read <a href="/">this</a>');
	});

	it("refuses params that are not the message's placeholders", () => {
		assert.throws(() => messageHtml("Hello, {name}", {}), /takes the params \{name\}, got \{\}/);
		assert.throws(() => messageHtml("Hello", { name: "Ada" }), /takes the params \{\}, got \{name\}/);
		assert.throws(() => messageHtml("Hello, {name}", { name: { first: "Ada" } }), /must be a string, a number or a SafeString/);
	});
});

describe("toSingleQuotedJsString", () => {
	it("writes a message as a single-quoted JavaScript string literal that cannot close its script", () => {
		assert.equal(toSingleQuotedJsString("You're offline"), "'You\\'re offline'");
		assert.equal(toSingleQuotedJsString("a\\b\nc\rd</script>\u2028\u2029"), "'a\\\\b\\nc\\rd\\u003c/script>\\u2028\\u2029'");
		assert.equal(toSingleQuotedJsString("Plain"), "'Plain'");
	});
});
