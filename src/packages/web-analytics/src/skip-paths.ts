const SKIP_PATHS = new Set([
	"/robots.txt",
	"/sitemap.xml",
	"/llms.txt",
	"/llms-full.txt",
	"/auth.md",
	"/favicon.ico",
	"/blog/sitemap.xml",
	"/blog/changelog-banner",
]);

export function isSkippedPath(path: string): boolean {
	return SKIP_PATHS.has(path) || path.startsWith("/.well-known/");
}
