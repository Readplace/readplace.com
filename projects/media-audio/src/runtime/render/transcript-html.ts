import { sanitizeArticleHtml } from "@packages/domain/article";
import { z } from "zod";

const HEADING_INTERVAL_SECONDS = 300;

const SecondsText = z.string().transform(Number).pipe(z.number().nonnegative());

export const TranscribeOutputSchema = z.object({
	results: z.object({
		items: z.array(
			z.object({ type: z.enum(["pronunciation", "punctuation"]) }),
		),
		audio_segments: z.array(
			z.object({ start_time: SecondsText, transcript: z.string() }),
		),
	}),
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
	return output.results.audio_segments.map((segment) => ({
		startSeconds: segment.start_time,
		text: segment.transcript,
	}));
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
