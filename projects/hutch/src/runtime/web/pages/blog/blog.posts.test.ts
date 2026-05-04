import { getAllPosts, findPostBySlug, getAllSlugs } from "./blog.posts";

describe("blog posts", () => {
	const posts = getAllPosts();

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
			expect(post.formattedDate).toMatch(/\d{1,2} \w+ \d{4}/);
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
		const firstPost = getAllPosts()[0];
		const post = findPostBySlug(firstPost.slug);
		expect(post).toBeDefined();
		expect(post?.title).toBe(firstPost.title);
	});

	it("should return undefined for an unknown slug", () => {
		expect(findPostBySlug("nonexistent-post")).toBeUndefined();
	});
});

describe("getAllSlugs", () => {
	it("should return slugs matching loaded posts", () => {
		const slugs = getAllSlugs();
		const posts = getAllPosts();
		expect(slugs).toEqual(posts.map((p) => p.slug));
	});
});
