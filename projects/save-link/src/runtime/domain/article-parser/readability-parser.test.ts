import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { initReadabilityParser } from "./readability-parser";
import type { SitePreParser } from "./article-parser.types";

const ARTICLE_HTML = `
<html>
<head>
  <title>Test Article Title</title>
  <meta property="og:site_name" content="Test Blog">
  <meta property="og:image" content="https://example.com/image.jpg">
</head>
<body>
  <article>
    <h1>Test Article Title</h1>
    <p>This is the first paragraph of the article with enough text to be meaningful content for readability extraction.</p>
    <p>This is the second paragraph with additional content that helps readability determine this is a real article worth parsing.</p>
    <p>And a third paragraph to ensure there is enough content for the word count calculation to work properly.</p>
  </article>
</body>
</html>`;

function initParser(overrides: {
	crawlArticle?: Parameters<typeof initReadabilityParser>[0]["crawlArticle"];
	sitePreParsers?: readonly SitePreParser[];
	logError?: (message: string, error?: Error) => void;
} = {}) {
	return initReadabilityParser({
		crawlArticle:
			overrides.crawlArticle ?? (async () => ({ status: "fetched" as const, html: ARTICLE_HTML })),
		sitePreParsers: overrides.sitePreParsers ?? [],
		logError: overrides.logError ?? (() => {}),
	});
}

describe("initReadabilityParser", () => {
	it("should extract article title from HTML", async () => {
		const { parseArticle } = initParser();

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.title).toBe("Test Article Title");
		}
	});

	it("should extract article content as HTML", async () => {
		const { parseArticle } = initParser();

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.content).toContain("first paragraph");
		}
	});

	it("should calculate word count from extracted text", async () => {
		const { parseArticle } = initParser();

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.wordCount).toBeGreaterThan(0);
		}
	});

	it("should pass through thumbnailUrl from the crawl result as imageUrl", async () => {
		const { parseArticle } = initParser({
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: ARTICLE_HTML,
				thumbnailUrl: "https://example.com/image.jpg",
			}),
		});

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.imageUrl).toBe("https://example.com/image.jpg");
		}
	});

	it("should return error for invalid URL", async () => {
		const { parseArticle } = initParser();

		const result = await parseArticle("not-a-url");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("Invalid URL");
		}
	});

	it("should return error when crawl fails", async () => {
		const { parseArticle } = initParser({
			crawlArticle: async () => ({ status: "failed" as const }),
		});

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("Could not fetch article");
		}
	});

	it("should return error when crawl returns not-modified (unexpected on first fetch)", async () => {
		const { parseArticle } = initParser({
			crawlArticle: async () => ({ status: "not-modified" as const }),
		});

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("Could not fetch article");
		}
	});

	it("should fall back to hostname when readability cannot parse", async () => {
		const { parseArticle } = initParser({
			crawlArticle: async () => ({ status: "fetched" as const, html: "<html><body></body></html>" }),
		});

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.title).toContain("example.com");
			expect(result.article.siteName).toBe("example.com");
		}
	});

	it("should use hostname as siteName when og:site_name is absent", async () => {
		const htmlWithoutSiteName = `
		<html><head><title>Post</title></head>
		<body><article>
			<h1>Post</h1>
			<p>Enough content to be parsed by readability as a real article with several words in this paragraph.</p>
			<p>Another paragraph for good measure with additional text.</p>
		</article></body></html>`;
		const { parseArticle } = initParser({
			crawlArticle: async () => ({ status: "fetched" as const, html: htmlWithoutSiteName }),
		});

		const result = await parseArticle("https://blog.example.com/post");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.siteName).toBe("blog.example.com");
		}
	});

	it("should use hostname as title when parsed title is empty string", async () => {
		const htmlWithEmptyTitle = `
		<html><head><title></title></head>
		<body><article>
			<p>Enough content to be parsed by readability as a real article with several words in this paragraph.</p>
			<p>Another paragraph for good measure with additional text to satisfy the parser minimum.</p>
		</article></body></html>`;
		const { parseArticle } = initParser({
			crawlArticle: async () => ({ status: "fetched" as const, html: htmlWithEmptyTitle }),
		});

		const result = await parseArticle("https://blog.example.com/post");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.title).toContain("blog.example.com");
		}
	});

	it("should return content string from parsed article", async () => {
		const { parseArticle } = initParser();

		const result = await parseArticle("https://example.com/article");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.article.content).toBe("string");
		}
	});

	it("should resolve relative image URLs to absolute", () => {
		const htmlWithRelativeImg = `
		<html><head><title>Post</title></head>
		<body><article>
			<h1>Post</h1>
			<p>Enough content to be parsed by readability as a real article with several words.</p>
			<img src="/images/diagram.jpg" alt="Diagram">
			<p>Another paragraph with additional text for the parser.</p>
		</article></body></html>`;

		const { parseHtml } = initParser();
		const result = parseHtml({ url: "https://blog.example.com/post", html: htmlWithRelativeImg });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.content).toContain('src="https://blog.example.com/images/diagram.jpg"');
			expect(result.article.content).not.toContain('src="/images/diagram.jpg"');
		}
	});

	it("should resolve relative link hrefs to absolute", () => {
		const htmlWithRelativeLink = `
		<html><head><title>Post</title></head>
		<body><article>
			<h1>Post</h1>
			<p>Enough content to be parsed by readability as a real article with several words.</p>
			<p>See <a href="/other-post">this other post</a> for more details.</p>
			<p>Another paragraph with additional text for the parser.</p>
		</article></body></html>`;

		const { parseHtml } = initParser();
		const result = parseHtml({
			url: "https://blog.example.com/post",
			html: htmlWithRelativeLink,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.content).toContain('href="https://blog.example.com/other-post"');
		}
	});

	it("should return error for invalid URL passed to parseHtml directly", () => {
		const { parseHtml } = initParser();
		const result = parseHtml({ url: "not-a-url", html: "<html><body></body></html>" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("Invalid URL");
		}
	});

	it("should use fallback values when readability returns empty fields", () => {
		const minimalHtml = `<html><head></head><body>${"<p>word </p>".repeat(100)}</body></html>`;
		const { parseHtml } = initParser();
		const result = parseHtml({ url: "https://example.com/page", html: minimalHtml });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.siteName).toBe("example.com");
			expect(typeof result.article.excerpt).toBe("string");
		}
	});

	describe("site pre-parser wiring", () => {
		it("uses the content returned by the first matching pre-parser whose extract returns a result", () => {
			const calls: string[] = [];
			const matchingPreParser: SitePreParser = {
				matches: ({ hostname }) => {
					calls.push(`matching.matches(${hostname})`);
					return hostname === "matching.example.com";
				},
				extract: ({ html: _html }) => {
					calls.push("matching.extract");
					return {
						title: "Pre-parser Injected Title",
						bodyHtml:
							"<p>Content injected by the matching pre-parser, long enough for readability to score it as the article body.</p>",
					};
				},
			};
			const nonMatchingPreParser: SitePreParser = {
				matches: ({ hostname }) => {
					calls.push(`nonMatching.matches(${hostname})`);
					return false;
				},
				extract: () => {
					calls.push("nonMatching.extract");
					return undefined;
				},
			};

			const { parseHtml } = initParser({
				sitePreParsers: [matchingPreParser, nonMatchingPreParser],
			});

			const result = parseHtml({
				url: "https://matching.example.com/article",
				html: "<html><body><nav>nav nav nav</nav><p>Original body that should be replaced.</p></body></html>",
			});

			expect(calls).toEqual([
				"matching.matches(matching.example.com)",
				"matching.extract",
			]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.title).toBe("Pre-parser Injected Title");
				expect(result.article.content).toContain("Content injected by the matching pre-parser");
				expect(result.article.content).not.toContain("Original body that should be replaced");
			}
		});

		it("falls through to the next pre-parser when extract returns undefined", () => {
			const calls: string[] = [];
			const firstPreParser: SitePreParser = {
				matches: () => true,
				extract: () => {
					calls.push("first.extract");
					return undefined;
				},
			};
			const secondPreParser: SitePreParser = {
				matches: () => true,
				extract: () => {
					calls.push("second.extract");
					return {
						bodyHtml:
							"<p>Second pre-parser body content, long enough for readability to score it as the article body with plenty of words.</p>",
					};
				},
			};

			const { parseHtml } = initParser({
				sitePreParsers: [firstPreParser, secondPreParser],
			});

			const result = parseHtml({
				url: "https://example.com/article",
				html: "<html><body><p>Original.</p></body></html>",
			});

			expect(calls).toEqual(["first.extract", "second.extract"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.content).toContain("Second pre-parser body content");
			}
		});

		it("leaves parsing to Readability when no pre-parser matches", () => {
			const nonMatching: SitePreParser = {
				matches: () => false,
				extract: () => undefined,
			};

			const { parseHtml } = initParser({
				sitePreParsers: [nonMatching],
			});

			const result = parseHtml({
				url: "https://example.com/article",
				html: `<html><head><title>Real Title</title></head><body><article><p>Real article body with enough words for readability to extract successfully as the main content.</p></article></body></html>`,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.title).toBe("Real Title");
				expect(result.article.content).toContain("Real article body");
			}
		});

		it("logs and swallows when a pre-parser throws, so parsing continues with the original HTML", () => {
			const logged: { message: string; error?: Error }[] = [];
			const throwingPreParser: SitePreParser = {
				matches: () => true,
				extract: () => {
					throw new Error("pre-parser boom");
				},
			};

			const { parseHtml } = initParser({
				sitePreParsers: [throwingPreParser],
				logError: (message, error) => logged.push({ message, error }),
			});

			const result = parseHtml({
				url: "https://example.com/article",
				html: `<html><body><article><p>Original body that remains after the throwing pre-parser was swallowed, with enough words for readability to score it.</p></article></body></html>`,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.content).toContain("Original body that remains");
			}
			expect(logged).toHaveLength(1);
			expect(logged[0].message).toContain("https://example.com/article");
			expect(logged[0].error?.message).toBe("pre-parser boom");
		});

		it("wraps non-Error throws into an Error before logging", () => {
			const logged: { message: string; error?: Error }[] = [];
			const throwingPreParser: SitePreParser = {
				matches: () => true,
				extract: () => {
					throw "string-not-error";
				},
			};

			const { parseHtml } = initParser({
				sitePreParsers: [throwingPreParser],
				logError: (message, error) => logged.push({ message, error }),
			});

			parseHtml({
				url: "https://example.com/article",
				html: `<html><body><article><p>Body with enough words for readability extraction to succeed even when the pre-parser fails.</p></article></body></html>`,
			});

			expect(logged).toHaveLength(1);
			expect(logged[0].error).toBeInstanceOf(Error);
			expect(logged[0].error?.message).toBe("string-not-error");
		});

		it("returns ok:false with the thrown error message when Readability crashes on the DOM (e.g. hex.ooo's _grabArticle null parent)", () => {
			const spy = jest.spyOn(Readability.prototype, "parse").mockImplementation(() => {
				throw new Error("Cannot read properties of null (reading 'tagName')");
			});
			try {
				const { parseHtml } = initParser();

				const result = parseHtml({
					url: "https://example.com/article",
					html: ARTICLE_HTML,
				});

				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.reason).toBe(
						"Readability parse failed: Cannot read properties of null (reading 'tagName')",
					);
				}
			} finally {
				spy.mockRestore();
			}
		});

		it("stringifies non-Error throws from Readability into the reason", () => {
			const spy = jest.spyOn(Readability.prototype, "parse").mockImplementation(() => {
				throw "bare-string-thrown";
			});
			try {
				const { parseHtml } = initParser();

				const result = parseHtml({
					url: "https://example.com/article",
					html: ARTICLE_HTML,
				});

				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.reason).toBe("Readability parse failed: bare-string-thrown");
				}
			} finally {
				spy.mockRestore();
			}
		});

		it("returns ok:false when the pre-Readability normalization step throws (linkedom returns documentElement=null for empty HTML, and the safety net must cover it)", () => {
			const { parseHtml } = initParser();

			const result = parseHtml({ url: "https://example.com/article", html: "" });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain("Readability parse failed:");
			}
		});

		/* Upstream Readability bug — linkedom leaves flow content as a
		 * sibling of the synthetic <body> when the source HTML omits a
		 * <body> tag, which makes Readability's _grabArticle parent walk
		 * overshoot into the document node and crash on null.tagName.
		 * See https://github.com/mozilla/readability/issues/435 and
		 * https://github.com/mozilla/readability/issues/757 — neither
		 * fixed in @mozilla/readability@0.6.0. */
		it("parses documents whose HTML omits <body> and leaves flow content as direct children of <html> (hex.ooo shape)", () => {
			const html = readFileSync(
				join(__dirname, "fixtures", "implicit-body-minimal.html"),
				"utf-8",
			);
			const { parseHtml } = initParser();

			const result = parseHtml({
				url: "https://hex.ooo/library/last_question.html",
				html,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.title).toBe("Isaac Asimov: The Last Question");
				expect(result.article.content).toContain(
					"he had had to carry the ice and glassware",
				);
			}
		});

		it("escapes HTML-significant characters in the extracted title", () => {
			const preParser: SitePreParser = {
				matches: () => true,
				extract: () => ({
					title: 'Weird <Title> with "quotes" & ampersand',
					bodyHtml:
						"<p>Body content with enough words to satisfy the readability extractor when this pre-parser runs.</p>",
				}),
			};

			const { parseHtml } = initParser({ sitePreParsers: [preParser] });
			const result = parseHtml({
				url: "https://example.com/article",
				html: "<html><body></body></html>",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.article.title).toBe('Weird <Title> with "quotes" & ampersand');
			}
		});
	});
});
