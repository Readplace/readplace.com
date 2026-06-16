import type { NextFunction, Request, Response } from "express";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

const NON_PAGE_PREFIXES = [
	"/robots.txt",
	"/llms.txt",
	"/llms-full.txt",
	"/auth.md",
	"/sitemap.xml",
	"/health",
	"/.well-known/api-catalog",
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
];

const AGENT_SKILLS_NAMESPACE = "/.well-known/agent-skills/";

function isNonPage(path: string): boolean {
	return NON_PAGE_PREFIXES.some(p => path === p) || path.startsWith(AGENT_SKILLS_NAMESPACE);
}

export function contentSignalMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (req.method === "GET" && !isNonPage(req.path)) {
		res.set("Content-Signal", CONTENT_SIGNAL_VALUE);
		res.vary("Accept");
	}
	next();
}
