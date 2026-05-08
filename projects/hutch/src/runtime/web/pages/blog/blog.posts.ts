import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true });

const BlogFrontmatter = z.object({
	title: z.string(),
	description: z.string(),
	slug: z.string(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	author: z.string(),
	keywords: z.string().optional(),
});

export type BlogPost = z.infer<typeof BlogFrontmatter> & {
	htmlContent: string;
	markdownContent: string;
	formattedDate: string;
};

function formatDate(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	return date.toLocaleDateString("en-AU", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

const postsDir = join(__dirname, "posts");

const files = readdirSync(postsDir).filter((f) => f.endsWith(".md"));

const posts: BlogPost[] = files
	.map((file) => {
		const raw = readFileSync(join(postsDir, file), "utf-8");
		const { data, content } = matter(raw);
		const frontmatter = BlogFrontmatter.parse(data);

		const expectedSlug = basename(file, ".md");
		assert(
			frontmatter.slug === expectedSlug,
			`Slug "${frontmatter.slug}" in ${file} does not match filename "${expectedSlug}"`,
		);

		return {
			...frontmatter,
			htmlContent: md.render(content),
			markdownContent: content,
			formattedDate: formatDate(frontmatter.date),
		};
	})
	.sort((a, b) => b.date.localeCompare(a.date));

const slugSet = new Set(posts.map((p) => p.slug));
assert(slugSet.size === posts.length, "Duplicate blog post slugs detected");

export function getAllPosts(): BlogPost[] {
	return posts;
}

export function findPostBySlug(slug: string): BlogPost | undefined {
	return posts.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
	return posts.map((p) => p.slug);
}

export function getAllPostMetadata(): { slug: string; date: string }[] {
	return posts.map((p) => ({ slug: p.slug, date: p.date }));
}
