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

	it("admits a video id whose length is not the historical 11 characters (gate relaxed)", () => {
		const embed = parseYouTubeEmbed("https://www.youtube.com/embed/short-id");
		expect(embed).toEqual({
			videoId: "short-id",
			watchUrl: "https://www.youtube.com/watch?v=short-id",
			posterUrl: "https://i.ytimg.com/vi/short-id/hqdefault.jpg",
		});
	});

	it("parses a /live/ID permalink URL", () => {
		const embed = parseYouTubeEmbed("https://www.youtube.com/live/hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("parses a /watch?v=ID URL on music.youtube.com", () => {
		const embed = parseYouTubeEmbed("https://music.youtube.com/watch?v=hVl9B3dTFB4");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
	});

	it("maps a /embed/videoseries playlist to a playlist watch URL with no poster", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/videoseries?list=PLabc_123")).toEqual({
			watchUrl: "https://www.youtube.com/playlist?list=PLabc_123",
		});
	});

	it("maps a /playlist?list=ID URL to a playlist watch URL", () => {
		const embed = parseYouTubeEmbed("https://www.youtube.com/playlist?list=PLabc_123");
		expect(embed?.watchUrl).toBe("https://www.youtube.com/playlist?list=PLabc_123");
	});

	it("prefers the concrete video when an embed carries both a video id and a list", () => {
		const embed = parseYouTubeEmbed("https://www.youtube.com/embed/hVl9B3dTFB4?list=PLabc_123");
		expect(embed?.videoId).toBe("hVl9B3dTFB4");
		expect(embed?.watchUrl).toBe("https://www.youtube.com/watch?v=hVl9B3dTFB4");
	});

	it("returns undefined for a videoseries embed with no list", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/videoseries")).toBeUndefined();
	});

	it("returns undefined when the video id contains an illegal character", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/embed/abcdefghij!")).toBeUndefined();
	});

	it("returns undefined when the playlist id contains an illegal character", () => {
		expect(parseYouTubeEmbed("https://www.youtube.com/playlist?list=PL/../evil")).toBeUndefined();
	});
});
