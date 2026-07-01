import { parseYouTubeEmbed } from "./parse-embed-url";

describe("parseYouTubeEmbed", () => {
	it("parses a standard /embed/ID player URL", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/hVl9B3dTFB4?color=white&modestbranding=1")).toEqual({
			videoId: "hVl9B3dTFB4",
			watchUrl: "https://www.youtube.com/watch?v=hVl9B3dTFB4",
			posterUrl: "https://i.ytimg.com/vi/hVl9B3dTFB4/hqdefault.jpg",
		});
	});

	it("parses a youtube-nocookie embed URL", () => {
		const embed = parseYouTubeEmbed("https://www.youtube-nocookie.com/embed/hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("parses a youtu.be short URL", () => {
		const embed = parseYouTubeEmbed("https://youtu.be/hVl9B3dTFB4");
		expect(embed?.watchUrl).toBe("https://www.youtube.com/watch?v=hVl9B3dTFB4");
	});

	it("parses a /watch?v=ID URL on m.youtube.com", () => {
		const embed = parseYouTubeEmbed("https://m.youtube.com/watch?v=hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("parses a /shorts/ID URL", () => {
		const embed = parseYouTubeEmbed("https://www.youtube.com/shorts/hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("parses a legacy /v/ID URL", () => {
		const embed = parseYouTubeEmbed("https://youtube.com/v/hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("returns undefined for a non-URL string", () => {
		expect(parseYouTubeEmbed("not a url")).toBeUndefined();
	});

	it("returns undefined for a non-YouTube host", () => {
		expect(parseYouTubeEmbed("https://player.vimeo.com/video/76979871")).toBeUndefined();
	});

	it("returns undefined for a look-alike host", () => {
		expect(parseYouTubeEmbed("https://evil-youtube.com/embed/hVl9B3dTFB4")).toBeUndefined();
	});

	it("returns undefined when /embed has no id", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed")).toBeUndefined();
	});

	it("returns undefined when /watch has no v parameter", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/watch?list=PL123")).toBeUndefined();
	});

	it("returns undefined for a youtu.be URL with no path", () => {
		expect(parseYouTubeEmbed("https://youtu.be/")).toBeUndefined();
	});

	it("returns undefined for an unrecognised YouTube path", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/channel/UC123")).toBeUndefined();
	});

	it("returns undefined for the bare YouTube origin", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/")).toBeUndefined();
	});

	it("returns undefined when the id is the wrong length", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/tooshort")).toBeUndefined();
	});

	it("returns undefined when the id contains an illegal character", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/abcdefghij!")).toBeUndefined();
	});
});
