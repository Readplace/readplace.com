import { z } from "zod";

const ReturnQuerySchema = z.looseObject({ return: z.string().optional() });

const RETURN_URL_BASE = "https://return-url.invalid";

function staysOnOrigin(returnUrl: string): boolean {
	if (!URL.canParse(returnUrl, RETURN_URL_BASE)) return false;
	const target = new URL(returnUrl, RETURN_URL_BASE);
	return target.origin === RETURN_URL_BASE && !target.pathname.startsWith("//");
}

function validatedReturnUrl(query: unknown): string | undefined {
	const parsed = ReturnQuerySchema.safeParse(query);
	const returnUrl = parsed.success ? parsed.data.return : undefined;
	if (returnUrl?.startsWith("/") && staysOnOrigin(returnUrl)) {
		return returnUrl;
	}
	return undefined;
}

export function parseReturnUrl(query: unknown): string {
	return validatedReturnUrl(query) ?? "/queue";
}

export function extractReturnUrl(query: unknown): string | undefined {
	return validatedReturnUrl(query);
}
