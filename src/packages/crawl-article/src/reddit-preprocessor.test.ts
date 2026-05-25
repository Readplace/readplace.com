import { initRedditPreprocessor } from "./reddit-preprocessor";

describe("initRedditPreprocessor", () => {
	it("rewrites www.reddit.com /comments/ URLs to old.reddit.com", async () => {
		const preprocess = initRedditPreprocessor();

		const result = await preprocess(
			"https://www.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/",
		);

		expect(result).toBe(
			"https://old.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/",
		);
	});

	it.each(["m.reddit.com", "np.reddit.com", "reddit.com"])(
		"rewrites %s /comments/ URLs to old.reddit.com",
		async (host) => {
			const preprocess = initRedditPreprocessor();

			const result = await preprocess(
				`https://${host}/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/`,
			);

			expect(result).toBe(
				"https://old.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/",
			);
		},
	);

	it("preserves search params and hash when rewriting", async () => {
		const preprocess = initRedditPreprocessor();

		const result = await preprocess(
			"https://www.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share#comments",
		);

		expect(result).toBe(
			"https://old.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share#comments",
		);
	});

	it("does not rewrite old.reddit.com URLs (they are the target form)", async () => {
		const preprocess = initRedditPreprocessor();
		const input = "https://old.reddit.com/r/javascript/comments/1tlsqd1/title/";

		const result = await preprocess(input);

		expect(result).toBe(input);
	});

	it("does not rewrite non-Reddit URLs", async () => {
		const preprocess = initRedditPreprocessor();
		const input = "https://example.com/article";

		const result = await preprocess(input);

		expect(result).toBe(input);
	});

	it("passes through malformed URLs unchanged", async () => {
		const preprocess = initRedditPreprocessor();
		const input = "not a url";

		const result = await preprocess(input);

		expect(result).toBe(input);
	});

	it("passes /r/<sub>/s/<id> shortlinks through unchanged (Lambda cannot resolve them — see module-level comment)", async () => {
		const preprocess = initRedditPreprocessor();
		const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

		const result = await preprocess(input);

		expect(result).toBe(input);
	});
});
