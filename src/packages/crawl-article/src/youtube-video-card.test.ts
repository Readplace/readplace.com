import { initFetchYouTubeVideoCard } from "./youtube-video-card";

const WATCH_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function answering(params: { status: number; body?: unknown }) {
	return jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(params.body), { status: params.status }));
}

function setup(fetchStub: typeof fetch) {
	const logError = jest.fn();
	return { fetchVideoCard: initFetchYouTubeVideoCard({ fetch: fetchStub, logError }), logError };
}

describe("initFetchYouTubeVideoCard", () => {
	it("asks oEmbed about the canonical watch URL under a timeout", async () => {
		const fetchStub = answering({ status: 200, body: { title: "T", author_name: "A" } });
		const { fetchVideoCard } = setup(fetchStub);

		await fetchVideoCard({ url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });

		const [url, init] = fetchStub.mock.calls[0];
		expect(url).toBe("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it.each([
		"https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs",
		"https://www.youtube.com/@TED",
		"https://www.youtube.com/",
		"https://example.com/watch?v=dQw4w9WgXcQ",
	])("declines %s without calling oEmbed", async (url) => {
		const fetchStub = answering({ status: 200, body: { title: "T", author_name: "A" } });
		const { fetchVideoCard } = setup(fetchStub);

		expect(await fetchVideoCard({ url })).toBeUndefined();
		expect(fetchStub).toHaveBeenCalledTimes(0);
	});

	it("builds the card from the title, the author and the parsed video alone", async () => {
		const { fetchVideoCard } = setup(answering({ status: 200, body: { title: "T", author_name: "A", html: "<iframe></iframe>", thumbnail_url: "https://evil.example/x.jpg" } }));

		expect(await fetchVideoCard({ url: WATCH_URL })).toEqual({
			title: "T",
			author: "A",
			excerpt: "Video by A on YouTube.",
			watchUrl: WATCH_URL,
			posterUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
			html: '<p class="reader-embed-facade"><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="Watch on YouTube" loading="lazy"></a></p>',
		});
	});

	it.each([400, 401, 403, 404, 500])("declines an oEmbed HTTP %i", async (status) => {
		const { fetchVideoCard, logError } = setup(answering({ status, body: {} }));

		expect(await fetchVideoCard({ url: WATCH_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] youtube oembed HTTP ${status} for ${WATCH_URL}`]]);
	});

	it("declines a 200 reply without a title or an author", async () => {
		const { fetchVideoCard, logError } = setup(answering({ status: 200, body: {} }));

		expect(await fetchVideoCard({ url: WATCH_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] youtube oembed payload rejected for ${WATCH_URL}`]]);
	});

	it("declines a 200 reply that is not JSON", async () => {
		const { fetchVideoCard, logError } = setup(async () => new Response("<html>Bad gateway</html>", { status: 200 }));

		expect(await fetchVideoCard({ url: WATCH_URL })).toBeUndefined();
		expect(logError.mock.calls.map(([message]) => message)).toEqual([`[CrawlArticle] youtube oembed error for ${WATCH_URL}`]);
	});

	it("declines a fetch that throws an Error", async () => {
		const failure = new Error("connect ETIMEDOUT");
		const { fetchVideoCard, logError } = setup(async () => { throw failure; });

		expect(await fetchVideoCard({ url: WATCH_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] youtube oembed error for ${WATCH_URL}`, failure]]);
	});

	it("declines a fetch that throws something other than an Error", async () => {
		const { fetchVideoCard, logError } = setup(async () => { throw "aborted"; });

		expect(await fetchVideoCard({ url: WATCH_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] youtube oembed error for ${WATCH_URL}`, undefined]]);
	});
});
