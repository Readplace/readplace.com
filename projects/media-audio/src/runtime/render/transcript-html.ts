import { sanitizeArticleHtml } from "@packages/domain/article";
import { z } from "zod";

const PARAGRAPH_PAUSE_SECONDS = 2;
const HEADING_INTERVAL_SECONDS = 300;

const SecondsText = z.string().transform(Number).pipe(z.number().nonnegative());

const TranscribeItemSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("pronunciation"),
		start_time: SecondsText,
		end_time: SecondsText,
		speaker_label: z.string().optional(),
		alternatives: z.array(z.object({ content: z.string() })).min(1),
	}),
	z.object({
		type: z.literal("punctuation"),
		alternatives: z.array(z.object({ content: z.string() })).min(1),
	}),
]);

export const TranscribeOutputSchema = z.object({
	results: z.object({ items: z.array(TranscribeItemSchema) }),
});
export type TranscribeOutput = z.infer<typeof TranscribeOutputSchema>;

type Paragraph = { startSeconds: number; text: string };

function twoDigits(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatTimestamp(totalSeconds: number): string {
	const whole = Math.floor(totalSeconds);
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const seconds = whole % 60;
	return hours > 0
		? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
		: `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function paragraphsOf(output: TranscribeOutput): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	let speaker: string | undefined;
	let lastEnd = 0;
	for (const item of output.results.items) {
		const content = item.alternatives[0].content;
		const current = paragraphs.at(-1);
		if (item.type === "punctuation") {
			if (current) current.text += content;
			continue;
		}
		const turn =
			current === undefined ||
			item.speaker_label !== speaker ||
			item.start_time - lastEnd >= PARAGRAPH_PAUSE_SECONDS;
		if (turn) paragraphs.push({ startSeconds: item.start_time, text: content });
		else current.text += ` ${content}`;
		speaker = item.speaker_label;
		lastEnd = item.end_time;
	}
	return paragraphs;
}

export function transcriptHtml(output: TranscribeOutput): {
	html: string;
	excerpt: string;
	wordCount: number;
} {
	const paragraphs = paragraphsOf(output);
	let lastHeading = -1;
	const blocks = paragraphs.flatMap((paragraph) => {
		const second = Math.floor(paragraph.startSeconds);
		const heading =
			Math.floor(second / HEADING_INTERVAL_SECONDS) * HEADING_INTERVAL_SECONDS;
		const headingBlock =
			heading > lastHeading ? [`<h2>${formatTimestamp(heading)}</h2>`] : [];
		lastHeading = Math.max(lastHeading, heading);
		return [
			...headingBlock,
			`<p><a href="?t=${second}">${formatTimestamp(second)}</a> ${escapeHtml(paragraph.text)}</p>`,
		];
	});
	return {
		html: sanitizeArticleHtml(blocks.join("")),
		excerpt: paragraphs[0]?.text ?? "",
		wordCount: output.results.items.filter(
			(item) => item.type === "pronunciation",
		).length,
	};
}
