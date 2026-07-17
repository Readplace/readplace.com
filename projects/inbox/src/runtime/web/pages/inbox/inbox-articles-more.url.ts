import { z } from "zod";
import { EMAIL_FEATURE } from "@packages/web-shell";

export const ARTICLES_PAGE_SIZE = 20;

const ArticlesShownSchema = z
	.object({ shown: z.coerce.number().int().min(1).optional().catch(undefined) })
	.passthrough();

export function parseArticlesShown(query: Record<string, unknown>): number {
	const parsed = ArticlesShownSchema.parse(query);
	return Math.max(ARTICLES_PAGE_SIZE, parsed.shown ?? ARTICLES_PAGE_SIZE);
}

export function buildInboxArticlesMoreUrl(params: { emailId: string; shown: number }): string {
	const search = new URLSearchParams();
	search.set("feature", EMAIL_FEATURE);
	search.set("shown", String(params.shown));
	return `/inbox/${encodeURIComponent(params.emailId)}/articles/more?${search.toString()}`;
}
