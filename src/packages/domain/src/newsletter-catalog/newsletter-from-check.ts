import { type NewsletterFrom, NewsletterFromSchema } from "./newsletter-catalog.schema";

const MISPLACED_STAR = /.\*|^\*[^@]/;

export type NewsletterFromRefusal = "unsupported-wildcard" | "invalid";

type NewsletterFromCheck = { ok: true; from: NewsletterFrom } | { ok: false; reason: NewsletterFromRefusal };

export function checkNewsletterFrom(candidate: string): NewsletterFromCheck {
	const parsed = NewsletterFromSchema.safeParse(candidate);
	if (parsed.success) return { ok: true, from: parsed.data };
	return { ok: false, reason: MISPLACED_STAR.test(candidate.trim()) ? "unsupported-wildcard" : "invalid" };
}
