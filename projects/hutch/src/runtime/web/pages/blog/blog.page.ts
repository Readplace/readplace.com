import type { Request, Response, Router } from "express";
import express from "express";
import { renderPage } from "../../render-page";
import { sendComponent } from "../../send-component";
import { BlogIndexPage } from "./blog-index.component";
import { BlogPostPage } from "./blog-post.component";
import { NotFoundPage } from "../not-found";
import { getAllPosts, findPostBySlug } from "./blog.posts";

const SLUG_REDIRECTS: Record<string, string> = {
	"hutch-vs-readwise-reader": "readplace-vs-readwise-reader",
	"hutch-vs-instapaper": "readplace-vs-instapaper",
	"hutch-vs-karakeep-hosted-vs-self-hosted-read-it-later": "readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later",
};

export function initBlogRoutes(): Router {
	const router = express.Router();

	router.get("/", (req: Request, res: Response) => {
		const posts = getAllPosts();
		sendComponent(req, res, renderPage(req, BlogIndexPage({ posts })));
	});

	router.get("/:slug", (req: Request, res: Response) => {
		const newSlug = SLUG_REDIRECTS[req.params.slug];
		if (newSlug) {
			res.redirect(301, `/blog/${newSlug}`);
			return;
		}
		const post = findPostBySlug(req.params.slug);
		if (!post) {
			sendComponent(req, res, renderPage(req, NotFoundPage()));
			return;
		}
		sendComponent(req, res, renderPage(req, BlogPostPage({ post })));
	});

	return router;
}
