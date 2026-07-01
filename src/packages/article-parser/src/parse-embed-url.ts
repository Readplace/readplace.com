export interface YouTubeEmbed {
	videoId: string;
	watchUrl: string;
	posterUrl: string;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"m.youtube.com",
	"youtube-nocookie.com",
]);

/* Every field is derived from the validated 11-character id, never from the
 * raw href, so a javascript:/data:/foreign-origin src cannot be smuggled into
 * the facade's link or poster. Returns undefined for anything that is not a
 * recognisable YouTube video URL. */
export function parseYouTubeEmbed(rawUrl: string): YouTubeEmbed | undefined {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return undefined;
	}
	const videoId = extractVideoId(url);
	if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) return undefined;
	return {
		videoId,
		watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
		posterUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
	};
}

function extractVideoId(url: URL): string | undefined {
	const host = url.hostname.replace(/^www\./, "");
	const segments = url.pathname.split("/").filter(Boolean);
	if (host === "youtu.be") return segments[0];
	if (!YOUTUBE_HOSTS.has(host)) return undefined;
	const [first, second] = segments;
	if (first === "embed" || first === "shorts" || first === "v") return second;
	if (first === "watch") {
		const fromQuery = url.searchParams.get("v");
		return fromQuery === null ? undefined : fromQuery;
	}
	return undefined;
}
