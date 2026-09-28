import { z } from "zod";

const GoogleTokenError = z.object({
	error: z.string(),
	error_description: z.string().optional(),
});

export function readGoogleTokenError(body: unknown): {
	error: string | undefined;
	errorDescription: string | undefined;
} {
	const parsed = GoogleTokenError.safeParse(body);
	if (!parsed.success) return { error: undefined, errorDescription: undefined };
	return { error: parsed.data.error, errorDescription: parsed.data.error_description };
}
