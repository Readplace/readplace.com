import { z } from "zod";

export const ARTICLES_PAGE_SIZE = 20;

// Tolerates a non-object because it reads request bodies as well as query
// strings: a POST that carries no body at all leaves `req.body` undefined, and
// an absent page size is the default page, not a request to reject.
const ArticlesShownSchema = z
	.object({ shown: z.coerce.number().int().min(1).optional().catch(undefined) })
	.passthrough()
	.catch({});

export function parseArticlesShown(source: unknown): number {
	const parsed = ArticlesShownSchema.parse(source);
	return Math.max(ARTICLES_PAGE_SIZE, parsed.shown ?? ARTICLES_PAGE_SIZE);
}

export function buildInboxArticlesMoreUrl(params: { emailId: string; shown: number }): string {
	const search = new URLSearchParams();
	search.set("shown", String(params.shown));
	return `/inbox/${encodeURIComponent(params.emailId)}/articles/more?${search.toString()}`;
}
