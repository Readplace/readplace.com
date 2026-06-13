import express, { type Express } from "express";
import { type BaseConfig, initBase } from "@packages/web-shell";
import { contentSignalMiddleware } from "./web/content-signal.middleware";
import { initBlogPosts } from "./web/pages/blog/blog.posts";
import { initBlogRoutes } from "./web/pages/blog/blog.page";

export const PORT = 3200;

/** Composition root for the blog site. The shell renderer is bound to this
 * deployable's static-asset origin (read from env at the entry point and passed
 * in, so the app factory stays env-free and testable). The blog has no DB or
 * auth, so every page renders with a guest banner state (see initBlogRoutes). */
export function createBlogApp(config: BaseConfig): Express {
	const app = express();
	app.disable("x-powered-by");

	const base = initBase(config);
	const blogPosts = initBlogPosts();

	app.use(contentSignalMiddleware);
	app.use("/blog", initBlogRoutes({ blogPosts, base }));

	return app;
}
