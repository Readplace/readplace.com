import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import {
	formatTimestamp,
	TranscribeOutputSchema,
	transcriptHtml,
} from "./transcript-html";

type Word = { word: string; start: number; speaker?: string };

function transcribeOutput(words: (Word | { punctuation: string })[]) {
	return TranscribeOutputSchema.parse({
		results: {
			items: words.map((entry) =>
				"punctuation" in entry
					? {
							type: "punctuation",
							alternatives: [{ content: entry.punctuation }],
						}
					: {
							type: "pronunciation",
							start_time: String(entry.start),
							end_time: String(entry.start + 0.5),
							speaker_label: entry.speaker ?? "spk_0",
							alternatives: [{ content: entry.word }],
						},
			),
		},
	});
}

function paragraphs(html: string): string[] {
	return Array.from(html.matchAll(/<p>(.*?)<\/p>/g), (match) => match[1]);
}

function headings(html: string): string[] {
	return Array.from(html.matchAll(/<h2[^>]*>/g), (match) => match[0]);
}

describe("formatTimestamp", () => {
	it.each([
		[0, "00:00"],
		[83, "01:23"],
		[300, "05:00"],
		[3725, "1:02:05"],
	])("formats %d seconds as %s", (seconds, label) => {
		assert.equal(formatTimestamp(seconds), label);
	});
});

describe("transcriptHtml", () => {
	it("starts a paragraph on a change of speaker", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ word: "Hello", start: 0, speaker: "spk_0" },
				{ punctuation: "." },
				{ word: "Hi", start: 1, speaker: "spk_1" },
				{ word: "there", start: 1.5, speaker: "spk_1" },
			]),
		);

		assert.deepEqual(paragraphs(html), [
			'<a href="?t=0">00:00</a> Hello.',
			'<a href="?t=1">00:01</a> Hi there',
		]);
	});

	it("starts a paragraph on a pause of two seconds or more", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ word: "One", start: 0 },
				{ word: "two", start: 2.4 },
				{ word: "three", start: 83 },
			]),
		);

		assert.deepEqual(paragraphs(html), [
			'<a href="?t=0">00:00</a> One two',
			'<a href="?t=83">01:23</a> three',
		]);
	});

	it("links each paragraph to its start second", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ word: "Later", start: 83.7 }]),
		);

		assert.deepEqual(paragraphs(html), ['<a href="?t=83">01:23</a> Later']);
	});

	it("heads every five minutes of a 400 second transcript with no heading id", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ word: "Start", start: 0 },
				{ word: "Middle", start: 200 },
				{ word: "Late", start: 310 },
				{ word: "End", start: 399 },
			]),
		);

		assert.deepEqual(
			Array.from(html.matchAll(/<h2>(.*?)<\/h2>/g), (match) => match[1]),
			["00:00", "05:00"],
		);
		assert.deepEqual(headings(html), ["<h2>", "<h2>"]);
	});

	it("keeps its timestamp links through the article sanitizer", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ word: "Kept", start: 300 }]),
		);

		assert.equal(sanitizeArticleHtml(html), html);
		assert.match(html, /<a href="\?t=300">05:00<\/a>/);
	});

	it("drops punctuation that comes before any spoken word", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ punctuation: "." }, { word: "Hello", start: 0 }]),
		);

		assert.deepEqual(paragraphs(html), ['<a href="?t=0">00:00</a> Hello']);
	});

	it("escapes the spoken text", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ word: "<b>", start: 0 }]),
		);

		assert.deepEqual(paragraphs(html), ['<a href="?t=0">00:00</a> &lt;b&gt;']);
	});

	it("counts the spoken words and takes the first paragraph as the excerpt", () => {
		const result = transcriptHtml(
			transcribeOutput([
				{ word: "First", start: 0 },
				{ punctuation: "," },
				{ word: "words", start: 0.5 },
				{ word: "Next", start: 9 },
			]),
		);

		assert.equal(result.wordCount, 3);
		assert.equal(result.excerpt, "First, words");
	});

	it("renders an empty transcript as no paragraphs", () => {
		assert.deepEqual(transcriptHtml(transcribeOutput([])), {
			html: "",
			excerpt: "",
			wordCount: 0,
		});
	});
});
