import type { fetchCurl } from "./curl-fetch";
import { initRedditPreprocessor } from "./reddit-preprocessor";

function noopLogError() {}

function curlReturning(response: Response): typeof fetchCurl {
	return async () => response;
}

function curlThrowing(error: Error): typeof fetchCurl {
	return async () => {
		throw error;
	};
}

describe("initRedditPreprocessor", () => {
	describe("URL rewriting (no fetch involved)", () => {
		it("rewrites www.reddit.com /comments/ URLs to old.reddit.com", async () => {
			const preprocess = initRedditPreprocessor({
				fetchCurl: curlReturning(new Response(null, { status: 200 })),
				logError: noopLogError,
			});

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
				const preprocess = initRedditPreprocessor({
					fetchCurl: curlReturning(new Response(null, { status: 200 })),
					logError: noopLogError,
				});

				const result = await preprocess(
					`https://${host}/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/`,
				);

				expect(result).toBe(
					"https://old.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/",
				);
			},
		);

		it("preserves search params and hash when rewriting", async () => {
			const preprocess = initRedditPreprocessor({
				fetchCurl: curlReturning(new Response(null, { status: 200 })),
				logError: noopLogError,
			});

			const result = await preprocess(
				"https://www.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share#comments",
			);

			expect(result).toBe(
				"https://old.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share#comments",
			);
		});

		it("does not rewrite old.reddit.com URLs (they are the target form)", async () => {
			const preprocess = initRedditPreprocessor({
				fetchCurl: curlReturning(new Response(null, { status: 200 })),
				logError: noopLogError,
			});
			const input = "https://old.reddit.com/r/javascript/comments/1tlsqd1/title/";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("does not rewrite non-Reddit URLs", async () => {
			const preprocess = initRedditPreprocessor({
				fetchCurl: curlReturning(new Response(null, { status: 200 })),
				logError: noopLogError,
			});
			const input = "https://example.com/article";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("passes through malformed URLs unchanged", async () => {
			const preprocess = initRedditPreprocessor({
				fetchCurl: curlReturning(new Response(null, { status: 200 })),
				logError: noopLogError,
			});
			const input = "not a url";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});
	});

	describe("/s/ shortlink resolution", () => {
		it("resolves /s/<id> to canonical via 301 Location, then rewrites to old.reddit.com", async () => {
			const canonical =
				"https://www.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/?share_id=abc";
			const fetchCurlImpl = jest.fn<ReturnType<typeof fetchCurl>, Parameters<typeof fetchCurl>>(async () =>
				new Response(null, { status: 301, headers: { location: canonical } }),
			);
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });

			const result = await preprocess("https://www.reddit.com/r/javascript/s/3GQafG3qjy");

			expect(result).toBe(
				"https://old.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/?share_id=abc",
			);
			expect(fetchCurlImpl).toHaveBeenCalledWith(
				"https://www.reddit.com/r/javascript/s/3GQafG3qjy",
				expect.objectContaining({ followRedirects: false }),
			);
		});

		it.each([302, 303, 307, 308])(
			"resolves /s/<id> on a %i status with Location",
			async (status) => {
				const fetchCurlImpl: typeof fetchCurl = async () =>
					new Response(null, {
						status,
						headers: { location: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/" },
					});
				const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });

				const result = await preprocess("https://www.reddit.com/r/javascript/s/3GQafG3qjy");

				expect(result).toBe("https://old.reddit.com/r/javascript/comments/1tlsqd1/title/");
			},
		);

		it("passes the original URL through when the shortlink response is 200 (no redirect)", async () => {
			const fetchCurlImpl: typeof fetchCurl = async () =>
				new Response("ok", { status: 200 });
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("passes the original URL through when the shortlink response is 403", async () => {
			const fetchCurlImpl: typeof fetchCurl = async () =>
				new Response("forbidden", { status: 403 });
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("passes the original URL through when the redirect response has no Location header", async () => {
			const fetchCurlImpl: typeof fetchCurl = async () =>
				new Response(null, { status: 301 });
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("passes the original URL through when the redirect target is not a Reddit URL", async () => {
			const fetchCurlImpl: typeof fetchCurl = async () =>
				new Response(null, {
					status: 301,
					headers: { location: "https://malicious.example.com/" },
				});
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
		});

		it("logs and passes through when the shortlink fetch throws", async () => {
			const logError = jest.fn<void, [string, Error?]>();
			const fetchCurlImpl = curlThrowing(new Error("network down"));
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
			expect(logError).toHaveBeenCalledWith(
				expect.stringContaining("shortlink resolution failed"),
				expect.any(Error),
			);
		});

		it("logs without an Error when the fetch throws a non-Error value", async () => {
			const logError = jest.fn<void, [string, Error?]>();
			const fetchCurlImpl: typeof fetchCurl = async () => {
				throw "string error";
			};
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError });
			const input = "https://www.reddit.com/r/javascript/s/3GQafG3qjy";

			const result = await preprocess(input);

			expect(result).toBe(input);
			expect(logError).toHaveBeenCalledWith(expect.stringContaining("shortlink resolution failed"), undefined);
		});

		it("resolves /s/<id> with a relative Location header against the shortlink origin", async () => {
			const fetchCurlImpl: typeof fetchCurl = async () =>
				new Response(null, {
					status: 301,
					headers: { location: "/r/javascript/comments/1tlsqd1/title/" },
				});
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });

			const result = await preprocess("https://www.reddit.com/r/javascript/s/3GQafG3qjy");

			expect(result).toBe("https://old.reddit.com/r/javascript/comments/1tlsqd1/title/");
		});

		it("does not treat /r/<sub>/comments/<id>/ as a shortlink", async () => {
			const fetchCurlImpl = jest.fn<ReturnType<typeof fetchCurl>, Parameters<typeof fetchCurl>>();
			const preprocess = initRedditPreprocessor({ fetchCurl: fetchCurlImpl, logError: noopLogError });

			await preprocess("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/");

			expect(fetchCurlImpl).not.toHaveBeenCalled();
		});
	});
});
