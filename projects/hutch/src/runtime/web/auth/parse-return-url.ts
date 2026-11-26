import { READER_HOME_HREF } from "../pages/readlist/built-in-readlists";
import { z } from "zod";
import { staysOnOrigin } from "../shared/safe-return-path";

const ReturnQuerySchema = z.looseObject({ return: z.string().optional() });

export function extractReturnUrl(query: unknown): string | undefined {
	const parsed = ReturnQuerySchema.safeParse(query);
	const returnUrl = parsed.success ? parsed.data.return : undefined;
	if (returnUrl?.startsWith("/") && staysOnOrigin(returnUrl)) {
		return returnUrl;
	}
	return undefined;
}

export function parseReturnUrl(query: unknown): string {
	return extractReturnUrl(query) ?? READER_HOME_HREF;
}
