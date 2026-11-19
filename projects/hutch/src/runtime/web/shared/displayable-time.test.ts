import { ABSENT_ENCLOSURE, type EnclosureRead, MinutesSchema } from "@packages/domain/article";
import { displayableTime } from "./displayable-time";

const ARTICLE = { url: "https://example.com/post", metadata: { wordCount: 1200 }, estimatedReadTime: MinutesSchema.parse(6) };

function ownedFor(durationSeconds: number): EnclosureRead {
	return {
		kind: "owned",
		enclosure: { object: `objects/sha256/${"b".repeat(64)}/1`, mediaType: "audio/mp4", durationSeconds },
	};
}

describe("displayableTime", () => {
	it("labels an owned enclosure with its listen time rounded up to the minute", () => {
		expect(displayableTime({ article: ARTICLE, enclosure: ownedFor(2820) })).toEqual({ value: "47", label: "47 min listen" });
		expect(displayableTime({ article: ARTICLE, enclosure: ownedFor(2821) })).toEqual({ value: "48", label: "48 min listen" });
	});

	it("labels the read time without an owned enclosure", () => {
		expect(displayableTime({ article: ARTICLE, enclosure: ABSENT_ENCLOSURE })).toEqual({ value: "6", label: "6 min read" });
	});

	it("omits the read time for a YouTube video save", () => {
		const video = { ...ARTICLE, url: "https://www.youtube.com/watch?v=J3PGI4yqta4" };

		expect(displayableTime({ article: video, enclosure: ABSENT_ENCLOSURE })).toBeUndefined();
	});

	it("labels an owned enclosure on a YouTube save with its listen time", () => {
		const video = { ...ARTICLE, url: "https://www.youtube.com/watch?v=J3PGI4yqta4" };

		expect(displayableTime({ article: video, enclosure: ownedFor(2820) })).toEqual({ value: "47", label: "47 min listen" });
	});
});
