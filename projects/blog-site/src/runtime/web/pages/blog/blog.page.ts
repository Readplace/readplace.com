import express, { type Request, type Response, type Router } from "express";
import {
	bannerStateFromRequest,
	CHANGELOG_DISMISS_COOKIE_NAME,
	type ChangelogBanner,
	readCookie,
	type RenderBase,
	renderChangelogBannerFragment,
	sendComponent,
} from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { BlogIndexPage } from "./blog-index.component";
import { BlogPostPage } from "./blog-post.component";
import { NotFoundPage } from "../not-found";
import type { BlogPosts } from "./blog.posts";

const CANONICAL_ORIGIN = "https://readplace.com";

/** Reads the host-only session cookie the browser already sends to /blog (hutch
 * owns it; path "/" makes it same-origin here) and turns it into the banner
 * state that flips the header between guest and authenticated nav. No cookie or
 * an invalid/expired session resolves to guest — exactly the previous
 * behaviour, now driven by the live session rather than a hardcoded guest. */
async function bannerStateFor(resolveLogin: ResolveLogin, req: Request) {
	const login = await resolveLogin(req.headers.cookie);
	/** Stamp the resolved user so the analytics middleware's res-finish hook can
	 * mark this pageview is_authenticated=1 — no extra session read, it reuses
	 * the login the banner already resolved. */
	if (login.isAuthenticated) req.userId = login.userId;
	return bannerStateFromRequest({
		userId: login.isAuthenticated ? login.userId : undefined,
		emailVerified: login.isAuthenticated ? login.emailVerified : undefined,
		originalUrl: req.originalUrl,
		cspNonce: req.cspNonce,
	});
}

/** Suppresses the banner when the reader's dismissal cookie matches its version.
 * Read straight off the raw Cookie header and compared byte-for-byte against the
 * version blog-site itself produced, so a dismissal on the app also hides it
 * here (shared cookie). */
function hideIfDismissed(
	banner: ChangelogBanner | undefined,
	req: Request,
): ChangelogBanner | undefined {
	if (!banner) return undefined;
	const dismissed = readCookie(req.headers.cookie, CHANGELOG_DISMISS_COOKIE_NAME);
	return dismissed === banner.version ? undefined : banner;
}

const SLUG_REDIRECTS: Record<string, string> = {
	"hutch-vs-readwise-reader": "readplace-vs-readwise-reader",
	"hutch-vs-instapaper": "readplace-vs-instapaper",
	"hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later": "readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later",
	"save-newsletter-links-to-your-queue": "save-newsletter-links-to-your-readlist",
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

export function initBlogRoutes(deps: {
	blogPosts: BlogPosts;
	base: RenderBase;
	resolveLogin: ResolveLogin;
}): Router {
	const router = express.Router();
	const { blogPosts, base, resolveLogin } = deps;

	/** Registered before `/:slug` so "sitemap.xml" is served as the sitemap
	 * rather than matched as a post slug. */
	router.get("/sitemap.xml", (_req: Request, res: Response) => {
		res.type("application/xml").send(renderSitemap(blogPosts));
	});

	/** The HTML contract hutch fetches to render the site-wide banner on its own
	 * pages. 200 carries the parseable fragment (with the version blog-site
	 * computed); 204 means there is nothing to announce. Registered before
	 * `/:slug` so "changelog-banner" is never matched as a post slug. */
	router.get("/changelog-banner", (_req: Request, res: Response) => {
		const banner = blogPosts.getLatestChangelogBanner();
		if (!banner) {
			res.status(204).end();
			return;
		}
		res.type("html").send(renderChangelogBannerFragment(banner));
	});

	router.get("/", async (req: Request, res: Response) => {
		const posts = blogPosts.getAllPosts();
		const changelogBanner = hideIfDismissed(blogPosts.getLatestChangelogBanner(), req);
		const state = await bannerStateFor(resolveLogin, req);
		sendComponent(req, res, base(BlogIndexPage({ posts }), { ...state, changelogBanner }));
	});

	router.get("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
		const newSlug = SLUG_REDIRECTS[req.params.slug];
		if (newSlug) {
			res.redirect(301, `/blog/${newSlug}`);
			return;
		}
		const post = blogPosts.findPostBySlug(req.params.slug);
		const changelogBanner = hideIfDismissed(blogPosts.getLatestChangelogBanner(), req);
		const state = await bannerStateFor(resolveLogin, req);
		if (!post) {
			sendComponent(req, res, base(NotFoundPage(), { ...state, changelogBanner }));
			return;
		}
		sendComponent(req, res, base(BlogPostPage({ post }), { ...state, changelogBanner }));
	});

	return router;
}
