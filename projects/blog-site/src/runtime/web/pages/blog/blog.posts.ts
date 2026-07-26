import assert from "node:assert";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";
import { iconSvg } from "@packages/ui-icons";
import {
	CHANGELOG_VERSION_LENGTH,
	type ChangelogBanner,
	isChangelogVersion,
	withInternalTracking,
} from "@packages/web-shell";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true });

const TLDR_SUMMARY = /(<summary class="blog-tldr__toggle">[^<]*)<\/summary>/g;

/** Draws the TL;DR disclosure's caret into every post at render time.
 *
 * The `<summary>` is hand-written HTML inside each post's markdown, so authoring
 * the caret beside it would paste the same icon geometry into 58 content files
 * and put a drawing where prose belongs. Injecting it once here keeps the icon
 * in the shared set and leaves the posts as text; the markdown representation is
 * the untouched source, which never carried the caret either. */
function withTldrCaret(html: string): string {
	return html.replace(
		TLDR_SUMMARY,
		`$1<span class="blog-tldr__caret">${iconSvg("chevron-down")}</span></summary>`,
	);
}

/** The tag that opts a post into the site-wide changelog banner. The newest
 * post carrying it drives the banner; the schema below requires such a post to
 * also supply `banner:` copy. */
const CHANGELOG_TAG = "changelog";

const BlogFrontmatter = z
	.object({
		title: z.string(),
		description: z.string(),
		slug: z.string(),
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		/** Set only on a post whose text has actually been revised since
		 * publication, so `dateModified` asserts something true rather than
		 * restating `date` for every post. */
		lastModified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
		author: z.string(),
		keywords: z.string().optional(),
		tags: z.array(z.string()).default([]),
		/** One-line hook shown in the site-wide banner. Required for a post tagged
		 * `changelog` (see refine) and ignored otherwise. */
		banner: z.string().optional(),
	})
	.refine(
		(value) => {
			if (!value.tags.includes(CHANGELOG_TAG)) return true;
			return value.banner !== undefined;
		},
		{
			message: 'A post tagged "changelog" must include a `banner:` one-liner for the site-wide banner.',
			path: ["banner"],
		},
	)
	.refine((value) => value.lastModified === undefined || value.lastModified >= value.date, {
		message: "`lastModified` cannot precede the post's `date`.",
		path: ["lastModified"],
	});

type BlogFrontmatterData = z.infer<typeof BlogFrontmatter>;

export type BlogPost = BlogFrontmatterData & {
	htmlContent: string;
	markdownContent: string;
	formattedDate: string;
};

/** Parses and validates one post's frontmatter, asserting the slug matches the
 * filename. Extracted (and exported) as a pure function so the schema rules —
 * the `tags` default, the changelog⇒banner requirement, and the slug invariant —
 * are covered without reading the posts directory. */
export function parseBlogFrontmatter(data: unknown, file: string): BlogFrontmatterData {
	const frontmatter = BlogFrontmatter.parse(data);
	const expectedSlug = basename(file, ".md");
	assert(
		frontmatter.slug === expectedSlug,
		`Slug "${frontmatter.slug}" in ${file} does not match filename "${expectedSlug}"`,
	);
	return frontmatter;
}

/** What `deriveChangelogBanner` needs from a post — a structural subset of
 * BlogPost so the derivation is testable without constructing full posts. */
interface ChangelogCandidate {
	slug: string;
	tags: string[];
	banner?: string;
}

/** Builds the banner from the newest changelog-tagged post (posts arrive sorted
 * newest-first). The version is the leading `CHANGELOG_VERSION_LENGTH` hex chars of
 * sha256("slug|banner") so any change to the slug or the copy yields a new version
 * and the banner reappears; the href is UTM-tagged here, at the single producer, so
 * hutch echoes it without re-tagging. */
export function deriveChangelogBanner(
	posts: readonly ChangelogCandidate[],
): ChangelogBanner | undefined {
	const latest = posts.find((post) => post.tags.includes(CHANGELOG_TAG));
	if (!latest) return undefined;
	assert(latest.banner !== undefined, "a changelog-tagged post must carry a banner (enforced at load)");
	const version = createHash("sha256")
		.update(`${latest.slug}|${latest.banner}`)
		.digest("hex")
		.slice(0, CHANGELOG_VERSION_LENGTH);
	assert(isChangelogVersion(version), "sha256 hex slice is always a valid changelog version");
	const href = withInternalTracking(`/blog/${latest.slug}`, {
		source: "changelog-banner",
		content: "read-more",
	});
	return { hook: latest.banner, href, version };
}

function formatDate(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	return date.toLocaleDateString("en-US", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

export interface BlogPosts {
	getAllPosts: () => BlogPost[];
	findPostBySlug: (slug: string) => BlogPost | undefined;
	getAllSlugs: () => string[];
	getAllPostMetadata: () => { slug: string; date: string }[];
	getLatestChangelogBanner: () => ChangelogBanner | undefined;
}

export function initBlogPosts(): BlogPosts {
	const postsDir = join(__dirname, "posts");
	const files = readdirSync(postsDir).filter((f) => f.endsWith(".md"));

	const posts: BlogPost[] = files
		.map((file) => {
			const raw = readFileSync(join(postsDir, file), "utf-8");
			const { data, content } = matter(raw);
			const frontmatter = parseBlogFrontmatter(data, file);

			return {
				...frontmatter,
				htmlContent: withTldrCaret(md.render(content)),
				markdownContent: content,
				formattedDate: formatDate(frontmatter.date),
			};
		})
		.sort((a, b) => b.date.localeCompare(a.date));

	const slugSet = new Set(posts.map((p) => p.slug));
	assert(slugSet.size === posts.length, "Duplicate blog post slugs detected");

	return {
		getAllPosts: () => posts,
		findPostBySlug: (slug) => posts.find((p) => p.slug === slug),
		getAllSlugs: () => posts.map((p) => p.slug),
		getAllPostMetadata: () => posts.map((p) => ({ slug: p.slug, date: p.date })),
		getLatestChangelogBanner: () => deriveChangelogBanner(posts),
	};
}
