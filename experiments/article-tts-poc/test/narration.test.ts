import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToNarration } from "../src/narration.ts";

test("strips inline tags and counts words and characters", () => {
	const narration = htmlToNarration({
		html: "<p>Hello <strong>world</strong></p>",
	});
	assert.equal(narration.text, "Hello world");
	assert.equal(narration.words, 2);
	assert.equal(narration.characters, 11);
	assert.ok(narration.estimatedAudioMinutes > 0);
});

test("never speaks script or style contents", () => {
	const narration = htmlToNarration({
		html: "<p>A</p><script>evil()</script><style>.x{color:red}</style><p>B</p>",
	});
	assert.ok(!narration.text.includes("evil"));
	assert.ok(!narration.text.includes("color"));
	assert.equal(narration.words, 2);
});

test("decodes named, decimal, and hex HTML entities", () => {
	const narration = htmlToNarration({
		html: "<p>Tom &amp; Jerry &#39;hi&#39; &#x41;</p>",
	});
	assert.ok(narration.text.includes("Tom & Jerry"));
	assert.ok(narration.text.includes("'hi'"));
	assert.ok(narration.text.endsWith("A"));
});

test("block elements are separated so words do not run together", () => {
	const narration = htmlToNarration({ html: "<h2>Title</h2><p>Body</p>" });
	assert.ok(narration.text.includes("Title"));
	assert.ok(narration.text.includes("Body"));
	assert.ok(!narration.text.includes("TitleBody"));
	assert.equal(narration.words, 2);
});

test("empty input yields an empty, zero-cost narration", () => {
	const narration = htmlToNarration({ html: "" });
	assert.equal(narration.text, "");
	assert.equal(narration.words, 0);
	assert.equal(narration.characters, 0);
	assert.equal(narration.estimatedAudioMinutes, 0);
});

test("leaves out-of-range numeric entities intact instead of crashing", () => {
	const narration = htmlToNarration({
		html: "<p>edge &#1114112; &#x110000; case</p>",
	});
	assert.ok(narration.text.includes("edge"));
	assert.ok(narration.text.includes("case"));
	// Undecodable code points are preserved verbatim rather than throwing RangeError.
	assert.ok(narration.text.includes("&#1114112;"));
});

test("never speaks the contents of an unclosed script block", () => {
	const narration = htmlToNarration({
		html: "<p>Before</p><script>var secret = 1;",
	});
	assert.ok(narration.text.includes("Before"));
	assert.ok(!narration.text.includes("secret"));
});
