import type { Request, Response, Router } from "express";
import express from "express";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { BlogIndexPage } from "./blog-index.component";
import { BlogPostPage } from "./blog-post.component";
import { NotFoundPage } from "../not-found";
import type { BlogPosts } from "./blog.posts";

const SLUG_REDIRECTS: Record<string, string> = {
	"hutch-vs-readwise-reader": "readplace-vs-readwise-reader",
	"hutch-vs-instapaper": "readplace-vs-instapaper",
	"hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later": "readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later",
};

export function initBlogRoutes(deps: { blogPosts: BlogPosts; buildBannerState: BuildBannerState }): Router {
	const router = express.Router();
	const { blogPosts, buildBannerState } = deps;

	router.get("/", async (req: Request, res: Response) => {
		const posts = blogPosts.getAllPosts();
		sendComponent(req, res, Base(BlogIndexPage({ posts }), await buildBannerState(req)));
	});

	router.get("/:slug", async (req: Request, res: Response) => {
		const newSlug = SLUG_REDIRECTS[req.params.slug];
		if (newSlug) {
			res.redirect(301, `/blog/${newSlug}`);
			return;
		}
		const post = blogPosts.findPostBySlug(req.params.slug);
		if (!post) {
			sendComponent(req, res, Base(NotFoundPage(), await buildBannerState(req)));
			return;
		}
		sendComponent(req, res, Base(BlogPostPage({ post }), await buildBannerState(req)));
	});

	return router;
}
