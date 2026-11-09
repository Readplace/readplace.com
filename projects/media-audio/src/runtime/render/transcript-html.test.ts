import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import {
	formatTimestamp,
	TranscribeOutputSchema,
	transcriptHtml,
} from "./transcript-html";

type Segment = { start: number; transcript: string };

function transcribeOutput(segments: Segment[]) {
	return TranscribeOutputSchema.parse({
		results: {
			audio_segments: segments.map((segment) => ({
				start_time: String(segment.start),
				transcript: segment.transcript,
			})),
			items: segments.flatMap((segment) =>
				segment.transcript
					.split(" ")
					.flatMap((word) => [
						{ type: "pronunciation" },
						...(/[.,]$/.test(word) ? [{ type: "punctuation" }] : []),
					]),
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
	it("renders each Transcribe audio segment as a paragraph linked to its start second", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ start: 0.0, transcript: "Welcome to the show." },
				{ start: 19.5, transcript: "Today we talk about rivers." },
				{ start: 39.159, transcript: "Rivers run to the sea." },
			]),
		);

		assert.deepEqual(paragraphs(html), [
			'<a href="?t=0">00:00</a> Welcome to the show.',
			'<a href="?t=19">00:19</a> Today we talk about rivers.',
			'<a href="?t=39">00:39</a> Rivers run to the sea.',
		]);
	});

	it("heads 05:00 from a single-speaker segment that starts after five minutes", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ start: 0, transcript: "One" },
				{ start: 150, transcript: "Two" },
				{ start: 290, transcript: "Three" },
				{ start: 330, transcript: "Four" },
			]),
		);

		assert.deepEqual(
			Array.from(html.matchAll(/<h2>(.*?)<\/h2>/g), (match) => match[1]),
			["00:00", "05:00"],
		);
		assert.match(
			html,
			/<h2>05:00<\/h2><p><a href="\?t=330">05:30<\/a> Four<\/p>/,
		);
	});

	it("links each paragraph to its start second", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ start: 83.7, transcript: "Later" }]),
		);

		assert.deepEqual(paragraphs(html), ['<a href="?t=83">01:23</a> Later']);
	});

	it("heads every five minutes of a 400 second transcript with no heading id", () => {
		const { html } = transcriptHtml(
			transcribeOutput([
				{ start: 0, transcript: "Start" },
				{ start: 200, transcript: "Middle" },
				{ start: 310, transcript: "Late" },
				{ start: 399, transcript: "End" },
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
			transcribeOutput([{ start: 300, transcript: "Kept" }]),
		);

		assert.equal(sanitizeArticleHtml(html), html);
		assert.match(html, /<a href="\?t=300">05:00<\/a>/);
	});

	it("escapes the spoken text", () => {
		const { html } = transcriptHtml(
			transcribeOutput([{ start: 0, transcript: "<b>" }]),
		);

		assert.deepEqual(paragraphs(html), ['<a href="?t=0">00:00</a> &lt;b&gt;']);
	});

	it("counts the spoken words and takes the first paragraph as the excerpt", () => {
		const result = transcriptHtml(
			transcribeOutput([
				{ start: 0, transcript: "First, words" },
				{ start: 9, transcript: "Next" },
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
