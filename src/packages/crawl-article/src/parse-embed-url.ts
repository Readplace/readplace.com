export type YouTubeEmbed =
	| { kind: "video"; videoId: string; watchUrl: string; posterUrl: string }
	| { kind: "playlist"; watchUrl: string };

const URL_SAFE_ID = /^[A-Za-z0-9_-]+$/;

const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtube-nocookie.com",
]);

const VIDEO_PATH_PREFIXES = new Set(["embed", "shorts", "v", "live"]);

/* The trust boundary is the host allow-list: a URL that doesn't parse to a known
 * YouTube host (checked after stripping a leading `www.`) is rejected outright,
 * so a `javascript:`/`data:` or foreign-origin src can never reach the facade.
 * The watch link and poster are then rebuilt from a path/query token constrained
 * to URL-safe id characters — never the raw href — so nothing can smuggle an
 * extra path segment, query parameter, or origin through. The id length is
 * deliberately unconstrained: any recognisable YouTube embed is admitted,
 * whether a single video or a playlist. Returns undefined for everything else. */
export function parseYouTubeEmbed(rawUrl: string): YouTubeEmbed | undefined {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return undefined;
	}
	const host = url.hostname.replace(/^www\./, "");
	const segments = url.pathname.split("/").filter(Boolean);
	if (host === "youtu.be") return video(segments[0]);
	if (!YOUTUBE_HOSTS.has(host)) return undefined;
	const [first, second] = segments;
	if (VIDEO_PATH_PREFIXES.has(first)) {
		return second === "videoseries" ? playlist(url) : video(second);
	}
	if (first === "watch") return video(url.searchParams.get("v"));
	if (first === "playlist") return playlist(url);
	return undefined;
}

function video(id: string | null | undefined): YouTubeEmbed | undefined {
	if (!id || !URL_SAFE_ID.test(id)) return undefined;
	return {
		kind: "video",
		videoId: id,
		watchUrl: `https://www.youtube.com/watch?v=${id}`,
		posterUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
	};
}

function playlist(url: URL): YouTubeEmbed | undefined {
	const listId = url.searchParams.get("list");
	if (!listId || !URL_SAFE_ID.test(listId)) return undefined;
	return { kind: "playlist", watchUrl: `https://www.youtube.com/playlist?list=${listId}` };
}
