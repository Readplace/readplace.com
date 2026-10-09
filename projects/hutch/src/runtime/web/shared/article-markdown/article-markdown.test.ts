import matter from "gray-matter";
import {
	MinutesSchema,
	ReaderArticleHashId,
	type SavedArticle,
	articleDestinationUrl,
} from "@packages/domain/article";
import {
	DEFAULT_READLIST,
	DEFAULT_READLIST_SLUG,
	type ReadlistRef,
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import { articleMarkdown } from "./article-markdown";

const APP_ORIGIN = "https://readplace.test";
const ARTICLE_URL = "https://example.com/post";
const ARTICLE_ID = "1d990bb353ea3e44e1e1b66dc6c0b41f";

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: ReaderArticleHashId.fromHash(ARTICLE_ID),
		userId: UserIdSchema.parse("test-user-id"),
		url: ARTICLE_URL,
		destinationUrl: destinationUrl(ARTICLE_URL),
		metadata: {
			title: "Hello World",
			siteName: siteLabel("example.com"),
			excerpt: "Parsed blurb.",
			wordCount: 1200,
		},
		estimatedReadTime: MinutesSchema.parse(6),
		status: "unread",
		savedAt: new Date("2026-09-30T01:02:03.000Z"),
		...overrides,
	};
}

describe("articleMarkdown", () => {
	describe("a ready article", () => {
		it("writes the frontmatter, the summary callout and the converted body", () => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle(),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: {
						status: "ready",
						summary: "First point.\n\nSecond point.",
						excerpt: "Generated blurb.",
						topics: [],
					},
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Generated blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "ready",
				readplace_summary: "First point.\n\nSecond point.",
			});
			expect(parsed.content).toBe(
				"\n> [!summary] Summary (TL;DR)\n> First point.\n>\n> Second point.\n\nBody copy.\n",
			);
		});

		it("writes every key in its fixed order and ends the document with one newline", () => {
			const markdown = articleMarkdown({
				article: makeArticle({
					status: "read",
					readAt: new Date("2026-10-01T04:05:06.000Z"),
				}),
				readlist: DEFAULT_READLIST_SLUG,
				readlists: [DEFAULT_READLIST],
				appOrigin: APP_ORIGIN,
				crawl: { status: "ready" },
				content: "<h2>Why</h2><p>Because.</p>",
				summary: {
					status: "ready",
					summary: "First point.\n\nSecond point.",
					excerpt: "Generated blurb.",
					topics: [],
				},
			});

			expect(markdown).toBe(
				[
					"---",
					"title: Hello World",
					"source: 'https://example.com/post'",
					"site: example.com",
					"description: Generated blurb.",
					"created: '2026-09-30T01:02:03.000Z'",
					"words: 1200",
					"readplace_id: 1d990bb353ea3e44e1e1b66dc6c0b41f",
					"readplace_url: 'https://readplace.test/queue/1d990bb353ea3e44e1e1b66dc6c0b41f/view'",
					"readplace_status: read",
					"readplace_read_at: '2026-10-01T04:05:06.000Z'",
					"readplace_read_time: 6",
					"readplace_readlists:",
					"  - All",
					"readplace_content_status: ready",
					"readplace_summary_status: ready",
					"readplace_summary: |-",
					"  First point.",
					"",
					"  Second point.",
					"---",
					"",
					"> [!summary] Summary (TL;DR)",
					"> First point.",
					">",
					"> Second point.",
					"",
					"## Why",
					"",
					"Because.",
					"",
				].join("\n"),
			);
		});

		it("keeps a body that opens with a horizontal rule out of the frontmatter", () => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle(),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<hr><p>Hello</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
			});
			expect(parsed.content).toBe("\n---\n\nHello\n");
		});

		it("points source at the destination the article was merged onto and keeps the saved article's id", () => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						destinationUrl: articleDestinationUrl({
							url: ARTICLE_URL,
							displayUrl: "https://www.example.org/final-location",
						}),
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://www.example.org/final-location",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
			});
			expect(parsed.content).toBe("\nBody copy.\n");
		});
	});

	describe("the summary", () => {
		const unavailableSummaries: {
			label: string;
			summary: GeneratedSummary | undefined;
			status: GeneratedSummary["status"];
		}[] = [
			{ label: "missing", summary: undefined, status: "pending" },
			{ label: "pending", summary: { status: "pending" }, status: "pending" },
			{
				label: "failed",
				summary: { status: "failed", reason: "exhausted-retries" },
				status: "failed",
			},
			{ label: "skipped", summary: { status: "skipped" }, status: "skipped" },
		];

		it.each(unavailableSummaries)(
			"records a $label summary as $status and writes no callout",
			({ summary, status }) => {
				const parsed = matter(
					articleMarkdown({
						article: makeArticle(),
						readlist: DEFAULT_READLIST_SLUG,
						readlists: [DEFAULT_READLIST],
						appOrigin: APP_ORIGIN,
						crawl: { status: "ready" },
						content: "<p>Body copy.</p>",
						summary,
					}),
				);

				expect(parsed.data).toEqual({
					title: "Hello World",
					source: "https://example.com/post",
					site: "example.com",
					description: "Parsed blurb.",
					created: "2026-09-30T01:02:03.000Z",
					words: 1200,
					readplace_id: ARTICLE_ID,
					readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
					readplace_status: "unread",
					readplace_read_time: 6,
					readplace_readlists: ["All"],
					readplace_content_status: "ready",
					readplace_summary_status: status,
				});
				expect(parsed.content).toBe("\nBody copy.\n");
			},
		);

		it("keeps a 750-character summary on one line of the frontmatter", () => {
			const summary = `${"word ".repeat(149)}xxxxx`;

			const markdown = articleMarkdown({
				article: makeArticle(),
				readlist: DEFAULT_READLIST_SLUG,
				readlists: [DEFAULT_READLIST],
				appOrigin: APP_ORIGIN,
				crawl: { status: "ready" },
				content: "<p>Body copy.</p>",
				summary: { status: "ready", summary, topics: [] },
			});

			expect(markdown).toBe(
				[
					"---",
					"title: Hello World",
					"source: 'https://example.com/post'",
					"site: example.com",
					"description: Parsed blurb.",
					"created: '2026-09-30T01:02:03.000Z'",
					"words: 1200",
					"readplace_id: 1d990bb353ea3e44e1e1b66dc6c0b41f",
					"readplace_url: 'https://readplace.test/queue/1d990bb353ea3e44e1e1b66dc6c0b41f/view'",
					"readplace_status: unread",
					"readplace_read_time: 6",
					"readplace_readlists:",
					"  - All",
					"readplace_content_status: ready",
					"readplace_summary_status: ready",
					`readplace_summary: ${summary}`,
					"---",
					"",
					"> [!summary] Summary (TL;DR)",
					`> ${summary}`,
					"",
					"Body copy.",
					"",
				].join("\n"),
			);
			expect(matter(markdown).data.readplace_summary).toBe(summary);
		});
	});

	describe("the content status", () => {
		const contentStates: {
			label: string;
			crawl: ArticleCrawl | undefined;
			content: string | undefined;
			summary: GeneratedSummary | undefined;
			frontmatter: Record<string, string>;
			body: string;
		}[] = [
			{
				label: "a failed crawl with older content still stored and no summary row",
				crawl: { status: "failed", reason: "blocked" },
				content: "<p>Older body.</p>",
				summary: undefined,
				frontmatter: { readplace_content_status: "failed" },
				body: "",
			},
			{
				label: "an unsupported crawl with older content still stored",
				crawl: { status: "unsupported", reason: "binary content" },
				content: "<p>Older body.</p>",
				summary: undefined,
				frontmatter: { readplace_content_status: "failed" },
				body: "",
			},
			{
				label: "a failed crawl that never stored any content and has no summary row",
				crawl: { status: "failed", reason: "blocked" },
				content: undefined,
				summary: undefined,
				frontmatter: { readplace_content_status: "failed" },
				body: "",
			},
			{
				label: "an unsupported crawl that never stored any content",
				crawl: { status: "unsupported", reason: "binary content" },
				content: undefined,
				summary: undefined,
				frontmatter: { readplace_content_status: "failed" },
				body: "",
			},
			{
				label: "a failed crawl while a ready summary is still stored",
				crawl: { status: "failed", reason: "blocked" },
				content: "<p>Older body.</p>",
				summary: { status: "ready", summary: "Older point.", topics: [] },
				frontmatter: { readplace_content_status: "failed" },
				body: "",
			},
			{
				label: "a pending crawl with older content still stored",
				crawl: { status: "pending" },
				content: "<p>Older body.</p>",
				summary: undefined,
				frontmatter: {
					readplace_content_status: "processing",
					readplace_summary_status: "pending",
				},
				body: "",
			},
			{
				label: "a pending crawl and no content",
				crawl: { status: "pending" },
				content: undefined,
				summary: undefined,
				frontmatter: {
					readplace_content_status: "processing",
					readplace_summary_status: "pending",
				},
				body: "",
			},
			{
				label: "a pending crawl while a ready summary is already stored",
				crawl: { status: "pending" },
				content: undefined,
				summary: { status: "ready", summary: "Older point.", topics: [] },
				frontmatter: {
					readplace_content_status: "processing",
					readplace_summary_status: "ready",
					readplace_summary: "Older point.",
				},
				body: "\n> [!summary] Summary (TL;DR)\n> Older point.\n",
			},
			{
				label: "a ready crawl with content",
				crawl: { status: "ready" },
				content: "<p>Body copy.</p>",
				summary: undefined,
				frontmatter: {
					readplace_content_status: "ready",
					readplace_summary_status: "pending",
				},
				body: "\nBody copy.\n",
			},
			{
				label: "a ready crawl whose content has not landed yet",
				crawl: { status: "ready" },
				content: undefined,
				summary: undefined,
				frontmatter: {
					readplace_content_status: "processing",
					readplace_summary_status: "pending",
				},
				body: "",
			},
			{
				label: "no crawl row and content present",
				crawl: undefined,
				content: "<p>Body copy.</p>",
				summary: undefined,
				frontmatter: {
					readplace_content_status: "ready",
					readplace_summary_status: "pending",
				},
				body: "\nBody copy.\n",
			},
			{
				label: "no crawl row and no content",
				crawl: undefined,
				content: undefined,
				summary: undefined,
				frontmatter: {
					readplace_content_status: "processing",
					readplace_summary_status: "pending",
				},
				body: "",
			},
		];

		it.each(contentStates)("renders $label", ({ crawl, content, summary, frontmatter, body }) => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle(),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl,
					content,
					summary,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				...frontmatter,
			});
			expect(parsed.content).toBe(body);
		});

		it("delivers a just-saved article at once with the stub metadata its save stored", () => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						metadata: {
							title: "Article from example.com",
							siteName: siteLabel("example.com"),
							excerpt: "Saved from example.com.",
							wordCount: 0,
						},
						estimatedReadTime: MinutesSchema.parse(1),
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "pending" },
					content: undefined,
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Article from example.com",
				source: "https://example.com/post",
				site: "example.com",
				description: "Saved from example.com.",
				created: "2026-09-30T01:02:03.000Z",
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_readlists: ["All"],
				readplace_content_status: "processing",
				readplace_summary_status: "pending",
			});
			expect(parsed.content).toBe("");
		});
	});

	describe("a non-article host", () => {
		it("shows the host stub the owner reader shows and ignores what is stored for the article", () => {
			const mailUrl = "https://mail.google.com/mail/u/0/";
			const mailId = ReaderArticleHashId.from(mailUrl).value;

			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						id: ReaderArticleHashId.from(mailUrl),
						url: mailUrl,
						destinationUrl: destinationUrl(mailUrl),
						metadata: {
							title: "Inbox (3) - reader@example.com - Gmail",
							siteName: siteLabel("Gmail"),
							excerpt: "Stored excerpt that must not show.",
							wordCount: 450,
						},
						estimatedReadTime: MinutesSchema.parse(2),
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Stored body that must not show.</p>",
					summary: {
						status: "ready",
						summary: "Stored summary that must not show.",
						excerpt: "Stored blurb that must not show.",
						topics: [],
					},
				}),
			);

			expect(parsed.data).toEqual({
				title: "mail.google.com",
				source: "https://mail.google.com/mail/u/0/",
				site: "mail.google.com",
				created: "2026-09-30T01:02:03.000Z",
				readplace_id: mailId,
				readplace_url: `${APP_ORIGIN}/queue/${mailId}/view`,
				readplace_status: "unread",
				readplace_readlists: ["All"],
				readplace_content_status: "not-an-article",
			});
			expect(parsed.content).toBe("");
		});

		it("treats a webmail save with no crawl row, no summary row and no content as not an article", () => {
			const mailUrl = "https://mail.google.com/mail/u/0/";
			const mailId = ReaderArticleHashId.from(mailUrl).value;

			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						id: ReaderArticleHashId.from(mailUrl),
						url: mailUrl,
						destinationUrl: destinationUrl(mailUrl),
						metadata: {
							title: "Article from mail.google.com",
							siteName: siteLabel("mail.google.com"),
							excerpt: "Saved from mail.google.com.",
							wordCount: 0,
						},
						estimatedReadTime: MinutesSchema.parse(1),
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: undefined,
					content: undefined,
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "mail.google.com",
				source: "https://mail.google.com/mail/u/0/",
				site: "mail.google.com",
				created: "2026-09-30T01:02:03.000Z",
				readplace_id: mailId,
				readplace_url: `${APP_ORIGIN}/queue/${mailId}/view`,
				readplace_status: "unread",
				readplace_readlists: ["All"],
				readplace_content_status: "not-an-article",
			});
			expect(parsed.content).toBe("");
		});
	});

	describe("the reading state", () => {
		const readingStates: {
			label: string;
			article: Partial<SavedArticle>;
			frontmatter: Record<string, string>;
		}[] = [
			{
				label: "an unread article",
				article: { status: "unread" },
				frontmatter: { readplace_status: "unread" },
			},
			{
				label: "a read article with the time it was read",
				article: { status: "read", readAt: new Date("2026-10-01T04:05:06.000Z") },
				frontmatter: {
					readplace_status: "read",
					readplace_read_at: "2026-10-01T04:05:06.000Z",
				},
			},
		];

		it.each(readingStates)("records $label", ({ article, frontmatter }) => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle(article),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
				...frontmatter,
			});
			expect(parsed.content).toBe("\nBody copy.\n");
		});

		it("leaves out the word count and the read time while the word count is 0", () => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						metadata: {
							title: "Hello World",
							siteName: siteLabel("example.com"),
							excerpt: "Parsed blurb.",
							wordCount: 0,
						},
						estimatedReadTime: MinutesSchema.parse(1),
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
			});
			expect(parsed.content).toBe("\nBody copy.\n");
		});
	});

	describe("the description", () => {
		const descriptions: {
			label: string;
			excerpt: string;
			summary: GeneratedSummary;
			frontmatter: Record<string, string>;
		}[] = [
			{
				label: "the generated excerpt of a ready summary over the parsed one",
				excerpt: "Parsed blurb.",
				summary: { status: "ready", summary: "Gist.", excerpt: "Generated blurb.", topics: [] },
				frontmatter: { description: "Generated blurb." },
			},
			{
				label: "the parsed excerpt when the ready summary's excerpt is empty",
				excerpt: "Parsed blurb.",
				summary: { status: "ready", summary: "Gist.", excerpt: "", topics: [] },
				frontmatter: { description: "Parsed blurb." },
			},
			{
				label: "the parsed excerpt when the ready summary has no excerpt",
				excerpt: "Parsed blurb.",
				summary: { status: "ready", summary: "Gist.", topics: [] },
				frontmatter: { description: "Parsed blurb." },
			},
			{
				label: "no description when the ready summary's excerpt and the parsed one are both empty",
				excerpt: "",
				summary: { status: "ready", summary: "Gist.", excerpt: "", topics: [] },
				frontmatter: {},
			},
		];

		it.each(descriptions)("uses $label", ({ excerpt, summary, frontmatter }) => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						metadata: {
							title: "Hello World",
							siteName: siteLabel("example.com"),
							excerpt,
							wordCount: 1200,
						},
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "ready",
				readplace_summary: "Gist.",
				...frontmatter,
			});
			expect(parsed.content).toBe(
				"\n> [!summary] Summary (TL;DR)\n> Gist.\n\nBody copy.\n",
			);
		});
	});

	describe("YAML-sensitive text", () => {
		it("round-trips readlist labels, an emoji title and a summary full of YAML syntax exactly", () => {
			const summary = 'Key: value\n# not a heading\n"quoted" text\n- leading dash\n\nlast para';

			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						metadata: {
							title: 'Launch 🚀: the "v2" #1 - notes',
							siteName: siteLabel("example.com"),
							excerpt: "Parsed blurb.",
							wordCount: 1200,
						},
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [
						DEFAULT_READLIST,
						{ slug: ReadlistSlugSchema.parse("work-q4"), label: "Work: Q4" },
						{ slug: ReadlistSlugSchema.parse("dash"), label: "- dash" },
						{ slug: ReadlistSlugSchema.parse("tag"), label: "#tag" },
						{ slug: ReadlistSlugSchema.parse("say-hi"), label: 'say "hi"' },
					],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: { status: "ready", summary, excerpt: "Generated blurb.", topics: [] },
				}),
			);

			expect(parsed.data).toEqual({
				title: 'Launch 🚀: the "v2" #1 - notes',
				source: "https://example.com/post",
				site: "example.com",
				description: "Generated blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All", "Work: Q4", "- dash", "#tag", 'say "hi"'],
				readplace_content_status: "ready",
				readplace_summary_status: "ready",
				readplace_summary: summary,
			});
			expect(parsed.content).toBe(
				[
					"",
					"> [!summary] Summary (TL;DR)",
					"> Key: value",
					"> # not a heading",
					'> "quoted" text',
					"> - leading dash",
					">",
					"> last para",
					"",
					"Body copy.",
					"",
				].join("\n"),
			);
		});

		const awkwardTitles = [
			"true",
			"null",
			"2026",
			"2026-10-01",
			"- leading dash",
			"#hashtag first",
			'Why: a "quoted" title',
			"line one\nline two",
		];

		it.each(awkwardTitles)("keeps the title %j a string", (title) => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle({
						metadata: {
							title,
							siteName: siteLabel("example.com"),
							excerpt: "Parsed blurb.",
							wordCount: 1200,
						},
					}),
					readlist: DEFAULT_READLIST_SLUG,
					readlists: [DEFAULT_READLIST],
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title,
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_readlists: ["All"],
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
			});
			expect(parsed.content).toBe("\nBody copy.\n");
		});
	});

	describe("the reader link", () => {
		const readerLinks: {
			label: string;
			readlist: ReadlistSlug;
			readlists: readonly ReadlistRef[];
			frontmatter: Record<string, string | string[]>;
		}[] = [
			{
				label: "the bare path for an article in the default readlist",
				readlist: DEFAULT_READLIST_SLUG,
				readlists: [DEFAULT_READLIST],
				frontmatter: {
					readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
					readplace_readlists: ["All"],
				},
			},
			{
				label: "the bare path for an article in the default readlist and a custom one",
				readlist: DEFAULT_READLIST_SLUG,
				readlists: [
					DEFAULT_READLIST,
					{ slug: ReadlistSlugSchema.parse("reading-backlog"), label: "Reading backlog" },
				],
				frontmatter: {
					readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view`,
					readplace_readlists: ["All", "Reading backlog"],
				},
			},
			{
				label: "the readlist query for an article that lives only in a custom readlist",
				readlist: ReadlistSlugSchema.parse("reading-backlog"),
				readlists: [
					{ slug: ReadlistSlugSchema.parse("reading-backlog"), label: "Reading backlog" },
				],
				frontmatter: {
					readplace_url: `${APP_ORIGIN}/queue/${ARTICLE_ID}/view?queue=reading-backlog`,
					readplace_readlists: ["Reading backlog"],
				},
			},
		];

		it.each(readerLinks)("links to $label", ({ readlist, readlists, frontmatter }) => {
			const parsed = matter(
				articleMarkdown({
					article: makeArticle(),
					readlist,
					readlists,
					appOrigin: APP_ORIGIN,
					crawl: { status: "ready" },
					content: "<p>Body copy.</p>",
					summary: undefined,
				}),
			);

			expect(parsed.data).toEqual({
				title: "Hello World",
				source: "https://example.com/post",
				site: "example.com",
				description: "Parsed blurb.",
				created: "2026-09-30T01:02:03.000Z",
				words: 1200,
				readplace_id: ARTICLE_ID,
				readplace_status: "unread",
				readplace_read_time: 6,
				readplace_content_status: "ready",
				readplace_summary_status: "pending",
				...frontmatter,
			});
			expect(parsed.content).toBe("\nBody copy.\n");
		});
	});
});
