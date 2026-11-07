import assert from "node:assert/strict";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { type CardKind, cardKindLabel, cardKindOf, hoursAndMinutesRead } from "./card-kind-label";

const minutes = (value: number) => MinutesSchema.parse(value);

function book(input: { wordCount: number; estimatedReadTime: number; sectionCount: number | undefined }) {
	return {
		media: {
			kind: "book" as const,
			fileName: "dune.epub",
			routeId: ReaderArticleHashId.from("https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef"),
			sectionCount: input.sectionCount,
		},
		metadata: { title: "Dune", siteName: "Book", excerpt: "", wordCount: input.wordCount },
		estimatedReadTime: minutes(input.estimatedReadTime),
	};
}

describe("hoursAndMinutesRead", () => {
	it.each([
		[45, "45 min read"],
		[120, "2 h read"],
		[580, "9 h 40 min read"],
	])("reads %i minutes as %s", (value, expected) => {
		expect(hoursAndMinutesRead(minutes(value))).toBe(expected);
	});
});

function bookLabel(input: { wordCount: number; estimatedReadTime: number; sectionCount: number | undefined }) {
	const article = book(input);
	const cardKind = cardKindOf(article);
	assert(cardKind, "a book has a card kind");
	return cardKindLabel({
		kind: cardKind.kind,
		estimatedReadTime: article.estimatedReadTime,
		wordCount: article.metadata.wordCount,
		sectionCount: article.media.sectionCount,
		readTime: undefined,
	});
}

const AUDIO_KIND: CardKind = { name: "audio", label: "Audio", noun: "audio", icon: "file" };
const VIDEO_KIND: CardKind = { name: "video", label: "Video", noun: "video", icon: "file-down" };

describe("cardKindLabel", () => {
	it("labels a book with its chapters and its read time", () => {
		expect(bookLabel({ wordCount: 139_200, estimatedReadTime: 580, sectionCount: 23 })).toBe(
			"Book · 23 chapters · 9 h 40 min read",
		);
	});

	it("leaves the chapters out before they are counted", () => {
		expect(bookLabel({ wordCount: 139_200, estimatedReadTime: 580, sectionCount: undefined })).toBe(
			"Book · 9 h 40 min read",
		);
	});

	it("counts a single chapter in the singular", () => {
		expect(bookLabel({ wordCount: 0, estimatedReadTime: 0, sectionCount: 1 })).toBe("Book · 1 chapter");
	});

	it("leaves the read time out before the words are counted", () => {
		expect(bookLabel({ wordCount: 0, estimatedReadTime: 0, sectionCount: 23 })).toBe("Book · 23 chapters");
	});

	it("labels audio with its listen time", () => {
		expect(
			cardKindLabel({
				kind: AUDIO_KIND,
				estimatedReadTime: minutes(0),
				wordCount: 0,
				sectionCount: undefined,
				readTime: { value: "47", label: "47 min listen" },
			}),
		).toBe("Audio · 47 min listen");
	});

	it("labels video with its listen time", () => {
		expect(
			cardKindLabel({
				kind: VIDEO_KIND,
				estimatedReadTime: minutes(0),
				wordCount: 0,
				sectionCount: undefined,
				readTime: { value: "1", label: "1 min listen" },
			}),
		).toBe("Video · 1 min listen");
	});

	it("labels audio by its kind alone before its listen time is known", () => {
		expect(
			cardKindLabel({ kind: AUDIO_KIND, estimatedReadTime: minutes(0), wordCount: 0, sectionCount: undefined, readTime: undefined }),
		).toBe("Audio");
	});
});

describe("cardKindOf", () => {
	it("names the book kind with its badge icon", () => {
		expect(cardKindOf(book({ wordCount: 0, estimatedReadTime: 0, sectionCount: undefined }))?.kind).toEqual({
			name: "book",
			label: "Book",
			noun: "book",
			icon: "book",
		});
	});

	it("names the audio kind with its badge icon", () => {
		const routeId = ReaderArticleHashId.from(
			"https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
		);
		expect(
			cardKindOf({ media: { kind: "audio", fileName: "talk.mp3", routeId } })
				?.kind,
		).toEqual({
			name: "audio",
			label: "Audio",
			noun: "audio",
			icon: "file",
		});
	});

	it("gives an ordinary article no kind", () => {
		expect(cardKindOf({ media: undefined })).toBeUndefined();
	});
});
