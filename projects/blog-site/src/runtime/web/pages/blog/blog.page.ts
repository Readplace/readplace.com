import express, { type Request, type Response, type Router } from "express";
import { type BannerState, type RenderBase, sendComponent } from "@packages/web-shell";
import { BlogIndexPage } from "./blog-index.component";
import { BlogPostPage } from "./blog-post.component";
import { NotFoundPage } from "../not-found";
import type { BlogPosts } from "./blog.posts";

const CANONICAL_ORIGIN = "https://readplace.com";

/** The blog site has no DB or auth, so it cannot build an authenticated banner
 * state. Every page renders the guest header; a logged-in reader sees the
 * guest nav on /blog (the session cookie is never read here). */
const GUEST_STATE: BannerState = { isAuthenticated: false, emailVerified: undefined };

const SLUG_REDIRECTS: Record<string, string> = {
	"hutch-vs-readwise-reader": "readplace-vs-readwise-reader",
	"hutch-vs-instapaper": "readplace-vs-instapaper",
	"hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later": "readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later",
};

const BLOG_POST_PRIORITY: Record<string, string> = {
	"best-read-it-later-apps-2026": "0.9",
	"omnivore-alternative": "0.9",
	"readplace-vs-readwise-reader": "0.8",
	"readplace-vs-instapaper": "0.8",
	"how-ai-tldr-actually-works": "0.8",
	"free-read-it-later-apps-2026": "0.8",
	"readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later": "0.8",
};

function renderSitemap(blogPosts: BlogPosts): string {
	const pages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [
		{ loc: "/blog", priority: "0.8", changefreq: "weekly", lastmod: "2026-04-07" },
	];
	for (const post of blogPosts.getAllPostMetadata()) {
		pages.push({
			loc: `/blog/${post.slug}`,
			priority: BLOG_POST_PRIORITY[post.slug] ?? "0.7",
			changefreq: "weekly",
			lastmod: post.date,
		});
	}
	const urls = pages
		.map(
			(p) =>
				`  <url>\n    <loc>${CANONICAL_ORIGIN}${p.loc}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function initBlogRoutes(deps: { blogPosts: BlogPosts; base: RenderBase }): Router {
	const router = express.Router();
	const { blogPosts, base } = deps;

	/** Registered before `/:slug` so "sitemap.xml" is served as the sitemap
	 * rather than matched as a post slug. */
	router.get("/sitemap.xml", (_req: Request, res: Response) => {
		res.type("application/xml").send(renderSitemap(blogPosts));
	});

	router.get("/", (req: Request, res: Response) => {
		const posts = blogPosts.getAllPosts();
		sendComponent(req, res, base(BlogIndexPage({ posts }), GUEST_STATE));
	});

	router.get("/:slug", (req: Request<{ slug: string }>, res: Response) => {
		const newSlug = SLUG_REDIRECTS[req.params.slug];
		if (newSlug) {
			res.redirect(301, `/blog/${newSlug}`);
			return;
		}
		const post = blogPosts.findPostBySlug(req.params.slug);
		if (!post) {
			sendComponent(req, res, base(NotFoundPage(), GUEST_STATE));
			return;
		}
		sendComponent(req, res, base(BlogPostPage({ post }), GUEST_STATE));
	});

	return router;
}
