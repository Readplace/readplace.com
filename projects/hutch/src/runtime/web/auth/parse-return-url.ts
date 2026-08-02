import { z } from "zod";

const ReturnQuerySchema = z.looseObject({ return: z.string().optional() });

function validatedReturnUrl(query: unknown): string | undefined {
	const parsed = ReturnQuerySchema.safeParse(query);
	const returnUrl = parsed.success ? parsed.data.return : undefined;
	if (returnUrl?.startsWith("/") && !returnUrl.startsWith("//")) {
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
