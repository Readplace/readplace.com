import { createHash } from "node:crypto";
import { deriveChangelogBanner, initBlogPosts, parseBlogFrontmatter } from "./blog.posts";

const blogPosts = initBlogPosts();

const VALID_FRONTMATTER = {
	title: "A Post",
	description: "About something",
	slug: "a-post",
	date: "2026-01-02",
	author: "Fagner",
};

describe("blog posts", () => {
	const posts = blogPosts.getAllPosts();

	it("should load at least one post", () => {
		expect(posts.length).toBeGreaterThan(0);
	});

	it("should have required frontmatter fields on every post", () => {
		for (const post of posts) {
			expect(typeof post.title).toBe("string");
			expect(post.title.length).toBeGreaterThan(0);
			expect(typeof post.description).toBe("string");
			expect(post.description.length).toBeGreaterThan(0);
			expect(typeof post.slug).toBe("string");
			expect(post.slug).toMatch(/^[a-z0-9-]+$/);
			expect(typeof post.date).toBe("string");
			expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(typeof post.author).toBe("string");
			expect(post.author.length).toBeGreaterThan(0);
		}
	});

	it("should have rendered HTML content for every post", () => {
		for (const post of posts) {
			expect(post.htmlContent).toContain("<");
			expect(post.htmlContent.length).toBeGreaterThan(0);
		}
	});

	it("should retain the raw markdown body for every post", () => {
		for (const post of posts) {
			expect(typeof post.markdownContent).toBe("string");
			expect(post.markdownContent.length).toBeGreaterThan(0);
			expect(post.markdownContent).not.toContain("---\ntitle:");
		}
	});

	it("should have formatted dates for every post", () => {
		for (const post of posts) {
			expect(post.formattedDate).toMatch(/\w+ \d{1,2}, \d{4}/);
		}
	});

	it("should sort posts by date descending", () => {
		for (let i = 1; i < posts.length; i++) {
			expect(posts[i - 1].date >= posts[i].date).toBe(true);
		}
	});

	it("should have unique slugs", () => {
		const slugs = posts.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});

describe("findPostBySlug", () => {
	it("should return a post for a known slug", () => {
		const firstPost = blogPosts.getAllPosts()[0];
		const post = blogPosts.findPostBySlug(firstPost.slug);
		expect(post).toBeDefined();
		expect(post?.title).toBe(firstPost.title);
	});

	it("should return undefined for an unknown slug", () => {
		expect(blogPosts.findPostBySlug("nonexistent-post")).toBeUndefined();
	});
});

describe("getAllSlugs", () => {
	it("should return slugs matching loaded posts", () => {
		const slugs = blogPosts.getAllSlugs();
		const posts = blogPosts.getAllPosts();
		expect(slugs).toEqual(posts.map((p) => p.slug));
	});
});

describe("parseBlogFrontmatter", () => {
	it("defaults tags to an empty array when omitted", () => {
		const parsed = parseBlogFrontmatter(VALID_FRONTMATTER, "a-post.md");
		expect(parsed.tags).toEqual([]);
	});

	it("accepts a changelog-tagged post that carries banner copy", () => {
		const parsed = parseBlogFrontmatter(
			{ ...VALID_FRONTMATTER, tags: ["changelog"], banner: "I shipped a thing" },
			"a-post.md",
		);
		expect(parsed.tags).toEqual(["changelog"]);
		expect(parsed.banner).toBe("I shipped a thing");
	});

	it("rejects a changelog-tagged post with no banner copy", () => {
		expect(() =>
			parseBlogFrontmatter({ ...VALID_FRONTMATTER, tags: ["changelog"] }, "a-post.md"),
		).toThrow(/must include a `banner:`/);
	});

	it("carries a revision date when the post declares one, and none when it does not", () => {
		expect(
			parseBlogFrontmatter({ ...VALID_FRONTMATTER, lastModified: "2026-07-26" }, "a-post.md")
				.lastModified,
		).toBe("2026-07-26");
		expect(parseBlogFrontmatter(VALID_FRONTMATTER, "a-post.md").lastModified).toBeUndefined();
	});

	it("rejects a revision date that precedes publication", () => {
		expect(() =>
			parseBlogFrontmatter({ ...VALID_FRONTMATTER, lastModified: "2026-01-01" }, "a-post.md"),
		).toThrow(/cannot precede/);
	});

	it("rejects a post whose slug does not match its filename", () => {
		expect(() => parseBlogFrontmatter(VALID_FRONTMATTER, "different-name.md")).toThrow(
			/does not match filename/,
		);
	});
});

describe("deriveChangelogBanner", () => {
	function expectedVersion(slug: string, banner: string): string {
		return createHash("sha256").update(`${slug}|${banner}`).digest("hex").slice(0, 8);
	}

	it("returns undefined when no post is tagged changelog", () => {
		expect(
			deriveChangelogBanner([
				{ slug: "a", tags: [], banner: undefined },
				{ slug: "b", tags: ["news"], banner: undefined },
			]),
		).toBeUndefined();
	});

	it("builds the banner from the newest changelog post (first in the sorted list)", () => {
		const banner = deriveChangelogBanner([
			{ slug: "newer", tags: ["changelog"], banner: "The newest change" },
			{ slug: "older", tags: ["changelog"], banner: "An older change" },
		]);
		expect(banner).toEqual({
			hook: "The newest change",
			href: "/blog/newer?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
			version: expectedVersion("newer", "The newest change"),
		});
	});

	it("changes the version when the banner copy changes (so the banner reappears)", () => {
		const a = deriveChangelogBanner([{ slug: "s", tags: ["changelog"], banner: "First copy" }]);
		const b = deriveChangelogBanner([{ slug: "s", tags: ["changelog"], banner: "Second copy" }]);
		expect(a?.version).not.toBe(b?.version);
	});
});

describe("getLatestChangelogBanner", () => {
	it("returns either undefined or a well-formed banner for the on-disk posts", () => {
		const banner = blogPosts.getLatestChangelogBanner();
		if (banner !== undefined) {
			expect(banner.version).toMatch(/^[0-9a-f]{8}$/);
			expect(banner.href.startsWith("/blog/")).toBe(true);
			expect(banner.hook.length).toBeGreaterThan(0);
		}
	});
});
