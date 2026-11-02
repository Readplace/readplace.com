import assert from "node:assert/strict";
import Handlebars from "handlebars";
import { messageHtml } from "./message-html";

describe("messageHtml", () => {
	it("escapes & < > \" ' in the message text, so glyphs stay as written", () => {
		assert.equal(messageHtml(`Tom & Jerry's <"show"> — it’s on`, {}).toHTML(), "Tom &amp; Jerry&#x27;s &lt;&quot;show&quot;&gt; — it’s on");
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
