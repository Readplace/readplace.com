import { initFetchRedditPostCard } from "./reddit-post-card";

const POST_URL = "https://www.reddit.com/r/example_sub/comments/abc123/a_post_title/";
const CANONICAL_POST_URL = "https://www.reddit.com/r/example_sub/comments/abc123/";

function answering(params: { status: number; body?: unknown }) {
	return jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(params.body), { status: params.status }));
}

function setup(fetchStub: typeof fetch) {
	const logError = jest.fn();
	return { fetchPostCard: initFetchRedditPostCard({ fetch: fetchStub, logError }), logError };
}

describe("initFetchRedditPostCard", () => {
	it.each([
		"https://old.reddit.com/r/example_sub/comments/abc123/a_post_title/comment/def456/",
		"https://reddit.com/r/example_sub/comments/abc123",
		"http://www.reddit.com/r/example_sub/comments/abc123/?utm_source=share",
	])("asks oEmbed about the canonical post URL of %s under a timeout", async (url) => {
		const fetchStub = answering({ status: 200, body: { title: "T", author_name: "A" } });
		const { fetchPostCard } = setup(fetchStub);

		await fetchPostCard({ url });

		const [oembedUrl, init] = fetchStub.mock.calls[0];
		expect(oembedUrl).toBe("https://www.reddit.com/oembed?format=json&url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fexample_sub%2Fcomments%2Fabc123%2F");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it.each([
		"https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fexample.jpeg",
		"https://www.reddit.com/user/example_user/comments/abc123/a_post_title/",
		"https://www.reddit.com/r/example_sub/",
		"https://www.reddit.com/r/example_sub/top/",
		"https://www.reddit.com/",
		"https://new.reddit.com/r/example_sub/comments/abc123/",
		"https://example.com/r/example_sub/comments/abc123/",
	])("declines %s without calling oEmbed", async (url) => {
		const fetchStub = answering({ status: 200, body: { title: "T", author_name: "A" } });
		const { fetchPostCard } = setup(fetchStub);

		expect(await fetchPostCard({ url })).toBeUndefined();
		expect(fetchStub).toHaveBeenCalledTimes(0);
	});

	it("builds a title-only card from the title, the author and the parsed post", async () => {
		const { fetchPostCard } = setup(answering({ status: 200, body: { title: "Fish & <chips>", author_name: "A", html: "<blockquote></blockquote>" } }));

		expect(await fetchPostCard({ url: POST_URL })).toEqual({
			title: "Fish & <chips>",
			author: "A",
			subreddit: "example_sub",
			excerpt: "A",
			wordCount: 3,
			postUrl: CANONICAL_POST_URL,
			posterUrl: undefined,
			html: `<p class="reader-embed-facade"><a href="${CANONICAL_POST_URL}" target="_blank" rel="noopener noreferrer">Fish &amp; &lt;chips&gt;</a></p>`,
		});
	});

	it("shows the thumbnail oEmbed returns as the card's poster", async () => {
		const { fetchPostCard } = setup(answering({ status: 200, body: { title: "T", author_name: "A", thumbnail_url: "https://preview.redd.it/example.jpg?width=640&s=abc" } }));

		expect(await fetchPostCard({ url: POST_URL })).toMatchObject({
			posterUrl: "https://preview.redd.it/example.jpg?width=640&s=abc",
			html: `<p class="reader-embed-facade"><a href="${CANONICAL_POST_URL}" target="_blank" rel="noopener noreferrer"><img src="https://preview.redd.it/example.jpg?width=640&amp;s=abc" alt="T" loading="lazy"></a></p>`,
		});
	});

	it.each([400, 401, 403, 404, 500])("declines an oEmbed HTTP %i", async (status) => {
		const { fetchPostCard, logError } = setup(answering({ status, body: {} }));

		expect(await fetchPostCard({ url: POST_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] reddit oembed HTTP ${status}`]]);
	});

	it.each([
		{ body: {} },
		{ body: { title: "", author_name: "A" } },
		{ body: { title: "T", author_name: "A", thumbnail_url: "javascript:alert(1)" } },
	])("declines a 200 reply of $body", async ({ body }) => {
		const { fetchPostCard, logError } = setup(answering({ status: 200, body }));

		expect(await fetchPostCard({ url: POST_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] reddit oembed payload rejected`]]);
	});

	it("declines a 200 reply that is not JSON", async () => {
		const { fetchPostCard, logError } = setup(async () => new Response("<html>Bad gateway</html>", { status: 200 }));

		expect(await fetchPostCard({ url: POST_URL })).toBeUndefined();
		expect(logError.mock.calls.map(([message]) => message)).toEqual([`[CrawlArticle] reddit oembed error`]);
	});

	it("declines a fetch that throws an Error", async () => {
		const failure = new Error("connect ETIMEDOUT");
		const { fetchPostCard, logError } = setup(async () => { throw failure; });

		expect(await fetchPostCard({ url: POST_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] reddit oembed error`]]);
	});

	it("declines a fetch that throws something other than an Error", async () => {
		const { fetchPostCard, logError } = setup(async () => { throw "aborted"; });

		expect(await fetchPostCard({ url: POST_URL })).toBeUndefined();
		expect(logError.mock.calls).toEqual([[`[CrawlArticle] reddit oembed error`]]);
	});
});
