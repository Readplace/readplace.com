import express, { type Express } from "express";
import { type BaseConfig, initBase } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { contentSignalMiddleware } from "./web/content-signal.middleware";
import { initBlogPosts } from "./web/pages/blog/blog.posts";
import { initBlogRoutes } from "./web/pages/blog/blog.page";

export const PORT = 3200;

/** Composition root for the blog site. The shell renderer is bound to this
 * deployable's static-asset origin (read from env at the entry point and passed
 * in, so the app factory stays env-free and testable). `resolveLogin` is
 * required and wired at the entry point — the production lambda reads hutch's
 * session table, local dev uses an in-memory resolver — so a logged-in reader
 * sees the authenticated nav on /blog while guests and crawlers see the guest
 * nav. */
export function createBlogApp(config: BaseConfig, deps: { resolveLogin: ResolveLogin }): Express {
	const app = express();
	app.disable("x-powered-by");

	const base = initBase(config);
	const blogPosts = initBlogPosts();

	app.use(contentSignalMiddleware);
	app.use("/blog", initBlogRoutes({ blogPosts, base, resolveLogin: deps.resolveLogin }));

	return app;
}
